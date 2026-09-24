/**
 * 浏览器半边。轴伊 Joi 双衣装主题。
 *
 * 三件事，边界分明：
 *   ① 颜色 —— 一层 ctx.theme.overrideTokens，明暗双向。官方 API，presenter
 *      负责落到 body 行内样式，插件 dispose 时它自己收回。
 *   ② 设置 —— cell shadowing 把内置外观行换成「换装」行。官方替换路径，
 *      卸载后内置行自动回归。
 *   ③ 装饰 —— 立绘、鲸鱼娘、两个 Q 版角色、底纹、字标手术。这一层没有官方
 *      接缝可用，只能认领 DOM；失败姿态一律是 fail-soft（装饰不出现，
 *      不把原生界面弄坏）。
 *
 * 明暗自始至终归 app：body[data-ds-dark-theme] 是 ui-layout presenter 的私产，
 * 本插件从不写它。
 *
 * 设置通道分两代（见 settings-channel.ts）：旧线 ctx.settingsScope.bind、
 * 0.1.7-rc.1 起 ctx.configForms.get。两者都不是硬依赖 —— 声明进 inject 的话，
 * 缺席的那一代会让整个客户端插件永不 apply（主题整层消失）。所以这里只 inject
 * 真正必需的 theme 与 slots，设置通道按服务名各自试探，谁在场挂谁。
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
// 仅类型：把 ctx.theme / ctx.slots / ctx.configForms 的 Context 合并拉进来。
// 值导入会内联出重复的运行时实例，跨插件协作只能走 cordis 服务。
// slots 由 ui-renderer 提供（0.1.7 起），theme 由 ui-theme、configForms 由
// ui-settings；三者都是 type-only，构建期擦除，产物里不留 require。
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { SETTINGS_NAMESPACE, type JoiSettings, type Skin } from '../contract.ts'
import { SuitRuntime } from './suit.ts'
import { Surfaces } from './surfaces.ts'
import { SuitRow, type SuitRowInjected } from './SuitRow.tsx'
import { createSuitRowStore, type Preference } from './suit-row-store.ts'
import { installFavicon } from './favicon.ts'
import type { ConfigFormsSeam, SettingsScopeBinder } from './settings-channel.ts'

/** 客户端 cordis 上下文。类型图里没有客户端专属基类，宿主与浏览器共用 Context。 */
type ClientContext = Context

/**
 * 需要的服务。
 * · theme —— token 覆盖层与明暗偏好。
 * · slots —— 换装行的注册位。
 * 设置通道刻意不在列：它是可选的，按代试探（见 apply）。
 */
export const inject = ['theme', 'slots']

/** 装饰层暴露给回归脚本的读数入口。 */
declare global {
  interface Window {
    /** 四象限回归断言读这里；生产环境留着无害，它只读不写。 */
    __joi?: () => unknown
  }
}

/**
 * 浏览器插件体。
 * @param ctx - 客户端 cordis 上下文。
 */
export function apply(ctx: ClientContext): void {
  const suits = new SuitRuntime(ctx.theme)
  suits.start()
  const surfaces = new Surfaces(suits.skin, () => suits.persistence)

  ctx.effect(() => suits.subscribe((skin) => { surfaces.setSuit(skin) }), 'joi-theme: 皮肤 → 装饰层')

  // 设置通道接线。两条 ctx.inject 用动态服务名：cordis 的 inject 允许任意服务名，
  // 缺席的那条回调永不触发 —— 这就是同一份产物同时活在两代宿主上的机制。
  ctx.inject(['settingsScope'], (scoped) => {
    const binder = (scoped as unknown as { settingsScope?: SettingsScopeBinder }).settingsScope
    if (binder === undefined || typeof binder.bind !== 'function') return
    // 旧线：自有命名空间。远端浏览器没有特权设置 API 时这条通道给 unavailable，
    // SuitRuntime 退化为进程内偏好 + localStorage——与内置行同款降级。
    scoped.effect(
      () => suits.attach(binder.bind<JoiSettings>({ namespace: SETTINGS_NAMESPACE }), 'settingsScope'),
      'joi-theme: 设置通道（旧线 settingsScope）',
    )
  })
  ctx.inject(['configForms'], (scoped) => {
    const forms = (scoped as unknown as { configForms?: ConfigFormsSeam }).configForms
    if (forms === undefined || typeof forms.get !== 'function') return
    // 0.1.7-rc.1 起：命名空间就是本插件 Loader 行的 entry id，与 SETTINGS_NAMESPACE
    // 同值（见 cordis.patch.yml）。读到写回都会经 describe/update 落到 profile patch。
    scoped.effect(
      () => suits.attach(forms.get<JoiSettings>(SETTINGS_NAMESPACE), 'configForms'),
      'joi-theme: 设置通道（0.1.7 configForms）',
    )
  })

  // 🍊 favicon 也归主题：原生态下要把原图标还回去，否则标签页还挂着橘子。
  ctx.effect(() => {
    let undo: (() => void) | undefined = suits.isNative ? undefined : installFavicon()
    const off = suits.subscribe(() => {
      undo?.()
      undo = suits.isNative ? undefined : installFavicon()
    })
    return () => { off(); undo?.() }
  }, 'joi-theme: 🍊 favicon')
  ctx.effect(() => () => { surfaces.dispose() }, 'joi-theme: 装饰层')
  ctx.effect(() => () => { suits.dispose() }, 'joi-theme: token 覆盖层')

  installSuitRow(ctx, suits)

  // 量测入口。回归脚本用它取几何读数，比截图比对稳定得多。
  window.__joi = () => surfaces.metrics()
  ctx.effect(() => () => { delete window.__joi }, 'joi-theme: 量测入口')
}

/**
 * 用「换装」行遮蔽内置的「外观」行。
 *
 * 同 slot、同 id、priority −1：一格里最低 priority 的那条渲染，内置那条
 * （priority 默认 0）被遮住但仍在册，本插件卸载后它自动回归。
 * @param ctx - 客户端上下文。
 * @param suits - 衣装运行时。
 */
function installSuitRow(ctx: ClientContext, suits: SuitRuntime): void {
  const store = createSuitRowStore()
  let bound: BoundActions<typeof store> | undefined

  const preference = (): Preference => ctx.theme.getTheme().preference
  const sync = (): void => { bound?.sync(suits.skin, preference()) }

  ctx.on('theme/change', sync)
  ctx.effect(() => suits.subscribe(sync), 'joi-theme: 换装行同步')

  const injected = (actions: BoundActions<typeof store>): SuitRowInjected => {
    bound = actions
    // 从取值器再同步一次：注册到首次渲染之间的事件不会丢。
    sync()
    return {
      setSuit: (skin: Skin) => { suits.setSuit(skin) },
      // 明暗转交给 theme 服务。插件不碰 body 属性——那是 presenter 的私产。
      setTheme: (id: Preference) => { ctx.theme.setTheme(id) },
    }
  }

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'appearance',
    priority: -1,
    order: 10,
    store,
    inject: injected,
  }, SuitRow))
}
