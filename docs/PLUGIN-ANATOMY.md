# DSH 插件机制：0.6.2 候选

本说明针对本项目当前实现和 DSH 0.2.0-rc.2 所用接口，不承诺所有未来版本。完整安全接触面见 [SECURITY](../SECURITY.md)。

## 两半都在工作

| 半侧 | 入口 | 职责 |
|---|---|---|
| host | [lib/index.js](../lib/index.js) | 认证余额路由、命名凭据读取、供应商适配器、生命周期 |
| browser | [lib/client.js](../lib/client.js) | 公开的自包含组件、同源数据请求、金额与额度合并显示 |
| Codex 协议 | [lib/codex.js](../lib/codex.js) | 固定 app-server 握手、账户/额度读取、错误与子进程处理 |
| Codex 状态 | [lib/codex-entry.js](../lib/codex-entry.js) | 每次激活独立的预热、上一读数、旧数据标记和终止 |

浏览器产物由[模板](../src/client.bundle.js)、[core](../lib/core.js)、[registry](../lib/registry.js)内联生成。只依赖 `react`、`react/jsx-runtime` 等平台种子模块，不用包子路径同步 require。

## 两种依赖声明不是一个数组

[包清单](../package.json)的 `dsh.client.inject` 是客户端包依赖。产物的 `exports.inject = ['slots', 'remote']` 是运行时服务依赖，不能把这两者强行改成字面相同。

账号命名空间不是硬依赖：缺少 `remote.account` 时，账号这一条显示不可用，其余 host 路线继续显示。

[Loader 层](../cordis.patch.yml)中的 name 严格等于包名。改名需同步包、补丁、安装器和生成 ID，不能仅改某一处。

## 认证路由不能抢在 admission 前面

注册路线为：

```js
ctx.inject(['connection'], scope => {
  scope.effect(() => scope.connection.fetch.register({
    path: '/api/dsh-route-balance/balances',
    methods: ['GET', 'HEAD'],
    requestBody: 'buffered',
    fetch: async request => new Response(/* formatted JSON */),
  }), 'route-balance route');
});
```

DSH 的共享 `/api` 入口先执行 Host/Origin 和浏览器 cookie 验证，再选择已注册的精确 Fetch 路线。直接调用 webServer 注册 exact 路线会优先于 prefix admission，不能用它来假装已经受 `/api` 认证保护。

此路由路径固定，浏览器以 same-origin 凭据请求。HEAD 不读上游；未注册的方法在官方组合入口会落到 404。直接调用插件 handler 的防御性 405 不等于网络端点总会返回 405。

## Entry 契约

```js
{
  ok: true, version: 1, generated: '<ISO>',
  entries: [{
    id: '<stable id>', label: '<label>',
    kind: 'ready',
    amounts: [{ currency: 'CNY', text: '¥1.00' }],
    summary: '<quota text>', short: '<compact text>',
    detail: '<sanitized detail>', stale: false,
  }],
}
```

钱类使用 amounts；额度类使用 summary/short，不必带币种。ready 必须有有效 amounts 或非空 summary。主显示依次选 short、summary、amounts。未知数字、空字符串、布尔、null 和非法百分比不能被转换成可相信的 0/100%；真实 0 合法。

生成组件的回归必须读取实际渲染文本、tooltip 和状态，不能仅搜索源码是否有某个字段。产物与源码的字节一致性是单独闸门，陈旧不能跳过。

## 刷新与生命周期

浏览器默认五分钟轮询，也可以点击请求。host 的 API 余额有默认十秒短缓存和一次在途读取；点击不保证绕过短缓存。后台 Codex 默认四分钟预热；HTTP 路线只取内存，不触发进程。

Codex 初始化完成后发送 `initialized`，随后以 `account/read` 判断当前是否是 ChatGPT 订阅，再读取额度。它不解析 auth.json；但 Codex 自己的配置、认证、网络和数据库行为仍会发生。只希望读快照时使用 snapshot；不想要额度路线时使用 off。

缓存仅属于当前激活，不在不同账号/激活之间共享。失败标旧，超过三个后台间隔也标旧；未登录和 API Key 账户清除成功订阅读数。最紧窗口的显示与重置时间来自同一个窗口。手工快照永远标旧，并非当前身份证明。

销毁 host scope 会移除注册、取消供应商读取、关闭预热定时器并终止在途 Codex；销毁 browser store 会停止轮询。没有常驻本项目新服务。

## 验证层次

1. 纯逻辑：数值、失败码、生命周期和单飞。
2. 生成组件：实际加载并渲染自包含产物。
3. 安装：独立 profile，按字节验证 BOM、换行、注释、归属、回滚和两种 PowerShell 入口。
4. 打包：实际 tarball 文件及解包后导入。
5. 可选官方库：实际 Connection/Cordis/HTTP 桥 + 合成 cookie，不调用真实账户。
6. 真实部署/浏览器/供应商：另行授权，不能用前五层冒充。

详细检查入口见 [HANDOFF-VERIFICATION](HANDOFF-VERIFICATION.md)。
