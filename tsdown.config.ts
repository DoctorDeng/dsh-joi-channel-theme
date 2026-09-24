/**
 * 两个构建面，一次 tsdown：
 *   · 宿主半边 lib/index.js —— 普通 ESM，Loader 直接 import。
 *   · 浏览器半边 lib/client.js —— 闭包工厂产物，由 window.__ModuleLoader__ 装载。
 *
 * 客户端产物的形状不是自由发挥：dsh 的模块表用注入的 require 解析外部依赖，
 * 所以 bundle 必须是 CJS 主体外包一层 `__ModuleLoader__.load({id, factory})`。
 * banner/intro/footer 三段就是这层壳，与 harness 自带 packages/client/tsdown.client.ts
 * 的产物逐字节同形（对照 ui-goal 的 lib/client.js 实测）。
 *
 * 外部化名单只能是模块表里真有的那些。表里没有的 require 一定在运行时抛错，
 * 所以规则是「表内外部化，其余全部内联」——本包除 react 外无运行时依赖，
 * 跨插件协作一律走 cordis 服务（ctx.theme / ctx.slots / ctx.configForms）。
 *
 * 0.1.7-rc.1 起这份名单收成**两代模块表的交集**，因为同一个 bundle 要同时活在
 * 高低两代上（表本身随宿主走，见 dsh-client-modules 的 PLATFORM_MODULES）：
 *
 *   0.1.7-rc.1  react react/jsx-runtime react-dom react-dom/client cordis
 *               dsh-client-store ui-slots ui-primitives ui-dockkit
 *   旧线        本文件此前记录的那份名单：同名基座 + dsh-client-web-react /
 *               ui-attachment / dsh-client-schema-form，且没有 dsh-client-store
 *               与 ui-dockkit
 *
 * 表里多列的条目不影响产物（没 import 就没有 require）；真正要守的是
 * 「本包 import 的每个模块，两代表里都在」。目前实际只用到 react、
 * react/jsx-runtime 与 ui-primitives——三者两代都在，这也是本插件敢用一份
 * 产物同时供两代宿主的原因。需要 dsh-client-store 的 defineStore 之类时不能
 * 直接外部化：它在旧线是否在表里没有把握，而内联在两代上都安全
 * （见 src/client/suit-row-store.ts）。
 */
import type { UserConfig } from 'tsdown'

/** 两代客户端模块表的交集。与 packages/client/web/src/platform.ts 对齐。 */
const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
]

const ID = 'dsh-joi-channel-theme'

const host: UserConfig = {
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'neutral',
  dts: false,
  clean: false,
  outputOptions: { entryFileNames: 'index.js' },
}

const client: UserConfig = {
  entry: ['src/client/index.tsx'],
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  external: [...PLATFORM_MODULES],
  // 表内的交给 external，其余一律内联：模块表答不上来的 require 是必然的运行时抛错。
  noExternal: (id: string) => (PLATFORM_MODULES.includes(id) ? undefined : true),
  define: {
    'process.env.NODE_ENV': JSON.stringify(process.env.NODE_ENV ?? 'production'),
  },
  outputOptions: {
    entryFileNames: 'client.js',
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(ID)}, factory: (require) => {`,
    intro: 'var module = { exports: {} }; var exports = module.exports;',
    footer: 'return module.exports; } });',
  },
}

export default [host, client]
