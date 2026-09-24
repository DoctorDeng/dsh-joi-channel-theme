/**
 * 宿主半边。
 *
 * 两件事，按宿主的设置模型择一执行 —— 这是 0.1.7-rc.1 的 settings 重写
 * 留下的岔路，两条都要在，插件才能同时活在高低两代上：
 *
 *   ① 旧线（0.1.0-rc.5 ～ 0.1.2-alpha）：`settings.register(ns, schema)` 注册
 *      一个命名空间，浏览器半边 ctx.settingsScope.bind 有东西可绑，选择落
 *      $DSH_HOME 的用户设置文档。
 *   ② 0.1.7-rc.1 起：命名空间注册整个消失，设置改由**插件自己的 Loader 行
 *      Config** 承载 —— `settings.describe()` 只投影带 `volatile` 标记的字段，
 *      浏览器半边经 ctx.configForms.get(entryId) 读写，写盘落进 profile patch。
 *      所以这里导出带 .volatile() 的 Config，并用 configure({auto:false})
 *      声明本行不自建配置页（换装行在「通用设置」里，两处并存只会让人困惑）。
 *
 * 两条靠特性探测互斥：新线没有 register，旧线没有 configure。缺任一个都不该
 * 让插件失败 —— 设置是可选能力，远端浏览器场景下它可能根本没被组合进来。
 *
 * apply 不能省成空函数以外的东西：包必须出现在 Loader 的 entries 里，
 * client-modules 才会扫到 package.json 的 dsh.client 声明，
 * 进而把浏览器半边挂进 __DSH_BOOT__ 并在 /plugins/<id>/client.js 供应。
 */
import type { Context } from '@deepseek-ai/cordis'
// 类型侧副作用导入：把 @deepseek-ai/dsh-settings 对 cordis 的模块增强
// （ctx.settings 服务，见其 lib/types/index.d.ts 的 declare module '@deepseek-ai/cordis'）
// 拉进类型图，供下方 apply 的 settingsCtx.settings 使用。构建时擦除，
// 不产生任何运行时 import —— dsh 0.1.2-alpha 线已删除 settingsNamespace 等
// 具名导出，运行时不再依赖该包。
import type {} from '@deepseek-ai/dsh-settings'
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings'
import z from '@deepseek-ai/schemastery'
import { DEFAULT_SKIN, SETTINGS_NAMESPACE, SKINS, SUIT_FIELD, type JoiSettings } from './contract.ts'

export {
  DEFAULT_SKIN, DEFAULT_SUIT, SETTINGS_NAMESPACE, SKINS, SUITS, SUIT_FIELD,
  isSkin, isSuit, type JoiSettings, type Skin, type Suit,
} from './contract.ts'

/** 衣装偏好字段。两代共用一份定义：旧线要整段 schema，新线要同一个字段带标记。 */
const suitField = z.union([...SKINS]).default(DEFAULT_SKIN)

/** 衣装偏好的持久 schema，同时是浏览器侧校验用的 wire 信封。 */
export const JoiSettingsSchema: z<JoiSettings> = z.object({
  [SUIT_FIELD]: suitField,
})

/**
 * 把一个字段标成 0.1.7 的「活配置」。
 *
 * `.volatile()` 是 schemastery 3.18.3 才有的标记：被标记的字段由 loader 解析成
 * 只读引用、改动不重挂插件，`describe()` 也只投影这类字段。旧线随附的是 3.18.1，
 * 那里没有这个方法 —— 缺失时原样返回：那条线上配置由 settings.register 承载，
 * 这个标记无人读。因此这里是特性探测，不是版本判断。
 *
 * 声明的类型原样保留（标记改变的是 schema 解析成什么，不是插件读到的 Config 形状）。
 * @param schema - 字段 schema。
 * @returns 带 volatile 标记的 schema；没有该方法时原样返回。
 */
function markVolatile<T extends z<any>>(schema: T): T {
  const mark = (schema as unknown as { volatile?: () => T }).volatile
  return typeof mark === 'function' ? mark.call(schema) : schema
}

/**
 * 本插件 Loader 行的 Config。
 *
 * 0.1.7 起这是衣装偏好唯一的宿主侧落点：`describe()` 投影它、浏览器经
 * `configForms.get(<entry id>)` 读它、写回落进 profile patch。entry id 就是
 * cordis.patch.yml 里那一行的 `id`，与 SETTINGS_NAMESPACE 同值。
 */
export const Config = z.object({
  [SUIT_FIELD]: markVolatile(suitField),
})

/**
 * 旧线的表单服务面：`register(ns, schema)`。
 *
 * 0.1.0-rc.6 / 0.1.2-alpha 的 SettingsProvider 有它、没有 configure；
 * 0.1.7 的 SettingsForms 有 configure、没有它。两边都按结构探测调用，
 * 谁在场走谁，谁都不在也不影响渲染。
 */
interface LegacySettingsForms {
  /**
   * 注册一个命名空间 schema。
   * @param ns - 命名空间。
   * @param schema - 载荷 schema。
   * @returns 该命名空间的 owner scope（本插件用不到）。
   */
  register(ns: SettingsNamespace, schema: unknown): unknown
}

/**
 * 命名空间校验：复刻 rc.6 `settingsNamespace()` 包装器的原始模式
 * （`/^[a-z][a-z0-9-]*$/`），行为与旧版一致，但不依赖已删除的导出。
 */
const NAMESPACE_PATTERN = /^[a-z][a-z0-9-]*$/
const NAMESPACE = SETTINGS_NAMESPACE as SettingsNamespace
if (!NAMESPACE_PATTERN.test(NAMESPACE)) {
  throw new TypeError(`settings namespace "${NAMESPACE}" must match ${String(NAMESPACE_PATTERN)}`)
}

/**
 * 宿主插件体：设置服务在场时按宿主代数注册衣装段。
 *
 * 用 ctx.inject 而不是直接读服务，是因为 settings 是可选能力——
 * 远端浏览器场景下它可能根本没被组合进来，那时浏览器半边会走进程内兜底
 * （见 client/suit.ts）。缺它不该让插件失败。
 * @param ctx - 宿主上下文。
 */
export function apply(ctx: Context): void {
  ctx.inject(['settings'], (settingsCtx) => {
    const legacy = settingsCtx.settings as unknown as LegacySettingsForms
    if (typeof legacy.register === 'function') {
      legacy.register(NAMESPACE, JoiSettingsSchema)
    }
    // owner 必须显式传插件自己的 fiber：describe() 按 entry.fiber 取这份策略，
    // 默认值取的是这里 inject 出来的子 fiber，那份策略永远查不到。
    if (typeof settingsCtx.settings.configure === 'function') {
      settingsCtx.effect(() => settingsCtx.settings.configure({ auto: false }, ctx.fiber))
    }
  })
}
