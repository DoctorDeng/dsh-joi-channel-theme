/**
 * 衣装状态：当前是哪一套、怎么换、怎么记住。
 *
 * 三条约束决定了这里的形状：
 *   · 互斥。两套衣装各是一层 overrideTokens，切换必须「先卸后挂」。
 *     叠加层是按 seq 后来居上逐 token 合并的，两层并存不会得到后一套，
 *     只会得到「后一套盖住了前一套里同名的部分」——也就是混色。
 *   · 明暗不归我们。body[data-ds-dark-theme] 是 ui-layout presenter 的私产，
 *     外部写会被它改回去。衣装只管色相，明暗永远由 app 的外观设置驱动。
 *   · 偏好要能存。ui-theme 的偏好白名单只认 light/dark/system，
 *     自定义 id 存不进去，所以走本插件自有的设置命名空间。
 *
 * 持久化通道本身是两代的（见 settings-channel.ts）：这里只认一条通道面，
 * 由 index.tsx 把旧线 settingsScope 或新线 configForms 接进来。
 */
import { DEFAULT_SKIN, DEFAULT_SUIT, SUIT_FIELD, isSkin, type Skin, type Suit } from '../contract.ts'
import { tokensFor, type TokenOverrides } from './tokens.ts'
import { usable, type ChannelKind, type SuitChannel } from './settings-channel.ts'

/** 挂载/卸载一层 token 覆盖的最小面，便于测试替身。 */
export interface TokenLayerHost {
  /**
   * 挂一层覆盖。
   * @param source - 层标识（同名后挂会替换前一层）。
   * @param tokens - 覆盖表。
   * @returns 卸载该层的 disposer。
   */
  overrideTokens(source: string, tokens: TokenOverrides): () => void
}

/** 覆盖层标识。两套衣装共用同一个 source，保证任意时刻至多一层。 */
const LAYER = 'dsh-joi-channel-theme'

/**
 * 本地兜底存放键。
 *
 * 为什么需要兜底，两代的理由不同、结果一样：
 *
 *   · 旧线（0.1.0-rc.5 ～ 0.1.2-alpha）：宿主 apiproxy 里有一份硬编码的命名空间
 *     白名单（WEB_SETTINGS_NAMESPACES / PRODUCT_SETTINGS_NAMESPACES），
 *     `settings.describe` 只把名单内的段发给浏览器。源码注释写得很明白——
 *     「settings 接缝保持通用；未来的注册不会默认变成远端可读写」。第三方插件的
 *     设置段**按设计**到不了浏览器：宿主侧 register 成功，浏览器侧拿到 unavailable。
 *   · 0.1.7-rc.1 起：白名单没了，命名空间就是 Loader 行的 entry id，本插件终于
 *     能经 describe/update 落到 profile patch；但远端浏览器（非 loopback）那条
 *     连接仍是 memory 模式，写会被拒；组合里也未必有 ui-settings。
 *
 * 所以始终两级：官方通道可用时走它（并落 profile），否则落 localStorage。
 * localStorage 同样满足「过刷新与重启仍在」，代价是它绑在浏览器 origin 上，
 * 换浏览器或换机器不跟随。
 */
const LOCAL_KEY = 'dsh-joi-channel-theme.suit'

/** 衣装变化的订阅者。 */
export type SuitListener = (skin: Skin) => void

/**
 * 衣装运行时：持有当前衣装、唯一的 token 层，以及偏好读写。
 */
export class SuitRuntime {
  private current: Skin = DEFAULT_SKIN
  private detach: (() => void) | undefined
  private readonly listeners = new Set<SuitListener>()
  /** 用户是否已明确选过。未选过就不写盘——首装不该在设置文档里留痕。 */
  private chosen = false
  /** 关掉主题前那套衣装。再打开时回到它，而不是粗暴地回到默认。 */
  private lastSuit: Suit = DEFAULT_SUIT

  private readonly host: TokenLayerHost
  /** 当前的设置通道。两代宿主各给一条，先到者被后到者顶掉。 */
  private channel: SuitChannel | undefined
  /** 通道来自哪一代；只进排障读数，不参与行为。 */
  private channelKind: ChannelKind | 'none' = 'none'
  /** 通道订阅的退订函数。 */
  private unsubscribe: (() => void) | undefined

  /**
   * @param host - token 覆盖宿主（生产环境是 ctx.theme）。
   */
  constructor(host: TokenLayerHost) {
    this.host = host
  }

  /** @returns 当前皮肤（含 native）。 */
  get skin(): Skin {
    return this.current
  }

  /**
   * @returns 装饰层该用哪套衣装的素材。原生态下没有"当前衣装"可言，
   *          返回默认套只是给素材一个基准——原生态下装饰层本就不出图。
   */
  get suit(): Suit {
    return this.current === 'native' ? DEFAULT_SUIT : this.current
  }

  /** @returns 是否处于原生态（不着色、不装饰）。 */
  get isNative(): boolean {
    return this.current === 'native'
  }

  /**
   * 总开关。关 = 切到原生；开 = 回到关掉前那套衣装。
   * @param on - 是否让主题生效。
   */
  setEnabled(on: boolean): void {
    this.setSuit(on ? this.lastSuit : 'native')
  }

  /**
   * @returns 持久化通道的实况。`unavailable` / `memory` 表示这台机器上
   *          衣装偏好只在进程内有效——这是降级而不是故障，但必须能看见，
   *          否则「选了却没记住」会被当成随机 bug 反复排查。`kind` 指出
   *          这条通道来自哪一代宿主。
   */
  get persistence(): { channel: string, hostStatus: string, kind: ChannelKind | 'none', stored: unknown } {
    const snap = this.channel?.getSnapshot()
    return {
      // 实际生效的通道：host = 宿主设置文档（0.1.7 起落 profile patch）；local = localStorage 兜底。
      channel: snap !== undefined && usable(snap) ? 'host' : 'local',
      hostStatus: snap?.status ?? 'unbound',
      kind: this.channelKind,
      stored: this.read(),
    }
  }

  /**
   * 挂上一条设置通道。
   *
   * 采纳与订阅的顺序是硬的：先读现值再订阅。反过来的话，注册到订阅之间到达的
   * 变更没有第二次机会——那正是「别的窗口改了设置，这个窗口不动」的成因。
   * @param channel - 通道（旧线 SettingsScope 或新线 ConfigForm）。
   * @param kind - 通道来自哪一代。
   * @returns 卸下这条通道的 disposer，可直接交给 ctx.effect。
   */
  attach(channel: SuitChannel, kind: ChannelKind): () => void {
    this.detachChannel()
    this.channel = channel
    this.channelKind = kind
    const adopt = (): void => {
      const stored = this.readChannel()
      // 回读不写回：否则两个窗口会互相顶，谁也不让谁。
      if (stored !== undefined && stored !== this.current) this.setSuit(stored, false)
    }
    adopt()
    this.unsubscribe = channel.subscribe(adopt)
    return () => { this.detachChannel() }
  }

  /** 卸下当前通道并清掉订阅。幂等（HMR 下会被重复调用）。 */
  detachChannel(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
    this.channel = undefined
    this.channelKind = 'none'
  }

  /**
   * 从通道读衣装字段。
   * @returns 通道里存着的衣装，没读到或值非法则 undefined。
   */
  private readChannel(): Skin | undefined {
    const value = this.channel?.getSnapshot().value?.[SUIT_FIELD]
    return isSkin(value) ? value : undefined
  }

  /**
   * 读回持久偏好：官方通道优先，其次本地兜底。
   * @returns 存着的衣装，没有则 undefined。
   */
  private read(): Skin | undefined {
    const fromHost = this.readChannel()
    if (fromHost !== undefined) return fromHost
    try {
      const local = globalThis.localStorage?.getItem(LOCAL_KEY)
      if (isSkin(local)) return local
    } catch {
      // 隐私模式 / 禁用存储：读不到就当没存过，不是错误。
    }
    return undefined
  }

  /**
   * 写入持久偏好。两条通道都尝试：官方通道可用就走它，
   * 本地兜底无论如何都写——名单放开与否不该改变用户看到的行为。
   * @param suit - 要记住的衣装。
   */
  private write(suit: Skin): void {
    // 写失败不回滚界面：用户已经看见换装生效了，把它撤回去更费解。
    // 设置层自己有重试与回读恢复，这里只需要不让 rejection 逃逸。
    const channel = this.channel
    if (channel !== undefined && usable(channel.getSnapshot())) {
      void channel.set(SUIT_FIELD, suit).catch(() => {})
    }
    try {
      globalThis.localStorage?.setItem(LOCAL_KEY, suit)
    } catch {
      // 写不进去就只在本进程有效，与内置行在 memory 模式下的降级同义。
    }
  }

  /**
   * 读回持久偏好并挂上对应衣装。设置不可用时用默认衣装，
   * 这与内置外观行在 memory 模式下的降级语义一致。
   */
  start(): void {
    const stored = this.read()
    if (stored !== undefined) {
      this.current = stored
      this.chosen = true
      if (stored !== 'native') this.lastSuit = stored
    }
    this.mount()
  }

  /**
   * 换一套衣装。同一套重复调用是空操作（不重挂、不写盘、不通知）。
   * @param suit - 目标衣装。
   * @param persist - 是否写回设置文档；来自设置文档的回读要传 false。
   */
  setSuit(suit: Skin, persist = true): void {
    if (suit === this.current && (this.chosen || !persist)) return
    if (this.current !== 'native') this.lastSuit = this.current
    this.current = suit
    // 先卸后挂：同 source 的 overrideTokens 本身就会替换旧层，
    // 但显式卸载让「任意时刻至多一层」在代码里看得见，而不是靠实现细节兜着。
    this.mount()
    if (persist) {
      this.chosen = true
      this.write(suit)
    }
    for (const listener of this.listeners) listener(suit)
  }

  /**
   * 订阅衣装变化。
   * @param listener - 变化后调用。
   * @returns 取消订阅的 disposer。
   */
  subscribe(listener: SuitListener): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** 卸载 token 层与设置通道，并清空订阅。disposer 幂等（HMR 下会被重复调用）。 */
  dispose(): void {
    this.detach?.()
    this.detach = undefined
    this.detachChannel()
    this.listeners.clear()
  }

  /**
   * 卸掉旧层再挂新层。原生态只卸不挂。
   *
   * 只卸就够了：overrideTokens 的 disposer 精确回收它自己那一层，
   * 而内置 light/dark 的 tokens 是空对象，层没了就落回 app 原生取值。
   */
  private mount(): void {
    this.detach?.()
    this.detach = undefined
    if (this.current === 'native') return
    this.detach = this.host.overrideTokens(LAYER, tokensFor(this.current))
  }
}
