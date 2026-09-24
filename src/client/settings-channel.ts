/**
 * 设置通道：把两代宿主的两条接缝收成一个面。
 *
 * 宿主在 0.1.7-rc.1 重写了 settings，客户端那条路跟着换了名字与形状：
 *
 *   旧线（0.1.0-rc.5 ～ 0.1.2-alpha）  ctx.settingsScope.bind({ namespace })
 *   0.1.7-rc.1 起                    ctx.configForms.get(entryId)
 *
 * 两条接口的**读侧快照完全同形**（status / value / writable / mode），写侧同为
 * `set(field, value)`，命名空间在新线上就是本插件 Loader 行的 entry id —— 与
 * SETTINGS_NAMESPACE 同值。所以这里不是模拟层，只是一纸结构契约加一条可用性
 * 判据：SuitRuntime 只认识一种通道，两代的差异全部收在 index.tsx 的接线处。
 *
 * 零运行时依赖是刻意的：本文件会被内联进浏览器产物，任何 Node 侧或已被删除的包
 * 都不该从这里泄进去。
 */
import type { JoiSettings } from '../contract.ts'

/**
 * 通道快照。两代字段同名同义 —— 旧 `SettingsScopeSnapshot` 与新
 * `ConfigFormSnapshot` 都是这一组。
 */
export interface ChannelSnapshot<T> {
  /** `loading` 还没读到、`ready` 有值可读、`unavailable` 这条接缝不给这个命名空间。 */
  status: 'loading' | 'ready' | 'unavailable'
  /** 最近一次被接受的段；首次接受之前是 undefined。 */
  value: T | undefined
  /** 宿主是否接受写。memory 模式恒为 false。 */
  writable: boolean
  /** `host` 与宿主文档同步；`memory` 只活在本进程里（远端浏览器可能如此）。 */
  mode: 'host' | 'memory'
}

/** 一条设置通道的最小面。旧 SettingsScope 与新 ConfigForm 都结构满足它。 */
export interface PreferenceChannel<T> {
  /**
   * @returns 当前同步快照（下一次变化前引用稳定）。
   */
  getSnapshot(): ChannelSnapshot<T>
  /**
   * 订阅快照替换。
   * @param listener - 每次变化后调用。
   * @returns 退订函数。
   */
  subscribe(listener: () => void): () => void
  /**
   * 写一个字段。
   * @param field - 段内的标量字段名。
   * @param value - 用户选中的值。
   * @returns 宿主是否接受（旧线返回 void，新线返回 boolean，故只约束到 unknown）。
   */
  set(field: string, value: unknown): Promise<unknown>
}

/** 通道来自哪一代。排障读数用：一眼分辨跑在哪条宿主线上。 */
export type ChannelKind = 'settingsScope' | 'configForms'

/**
 * 通道此刻能不能当真：读到值、且写会被接受。
 *
 * 两代共用同一判据。旧代码只查 `status === 'ready'`，而 memory 模式（远端
 * 浏览器拿不到宿主文档）下 status 同为 ready、写却注定被拒 —— 白跑一趟线，
 * 还会让「选了没记住」看起来像偶发故障。memory 一律按本地兜底处理。
 * @param snapshot - 通道快照。
 * @returns 是否可作为持久通道使用。
 */
export function usable<T>(snapshot: ChannelSnapshot<T>): boolean {
  return snapshot.status === 'ready' && snapshot.writable && snapshot.mode === 'host'
}

/**
 * 旧线接缝：`ctx.settingsScope`（0.1.7 起该服务已从宿主与客户端整体移除）。
 *
 * 按结构声明而不是 import 那个包：本插件的类型图只按一代安装依赖，
 * 而运行时两代都要能跑。
 */
export interface SettingsScopeBinder {
  /**
   * 绑定一个命名空间。
   * @param spec - 命名空间标识。
   * @returns 该命名空间的通道。
   */
  bind<T>(spec: { namespace: string }): PreferenceChannel<T>
}

/**
 * 新线接缝：`ctx.configForms`。
 *
 * 同样按结构声明，理由与上面相同：本文件不该被任何一代的包名绑死。
 */
export interface ConfigFormsSeam {
  /**
   * 取一个 Loader 行的表单。
   * @param entryId - profile 里的 entry id。
   * @returns 该行的通道。
   */
  get<T>(entryId: string): PreferenceChannel<T>
}

/** 衣装偏好的通道类型别名，省得每处都写一遍泛型。 */
export type SuitChannel = PreferenceChannel<JoiSettings>
