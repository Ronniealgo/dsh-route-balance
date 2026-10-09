# 0.6.2 实验版独立验收入口

验证目标是发现反例，不是复述作者认为已经修好的结论。使用维护者提供的**公开仓库源码快照**（<https://github.com/Ronniealgo/dsh-route-balance>，0.6.2 为 GitHub pre-release 实验版），从仓库根目录执行。不得操作另一个 Web 项目，也不得默认读真实凭据、安装/卸载真实插件、重启 GUI 或发布。

## 可复现的基本验收

先提供测试专用 YAML 解析器；可使用离线已安装的解析器并设置 `DSH_ROUTE_BALANCE_YAML_PACKAGE`。插件没有运行时依赖，测试依赖准备并不等于插件运行时需要安装新库。

```bash
node tools/build-client.mjs --check
node tools/check-package.mjs
node tools/run-tests.mjs
```

期望各命令真实退出码 0，主 suite 没有未解释失败/取消。runner 自测中合成的失败、退出 7、超时是预期反例，只有外层断言通过才算覆盖；不能把其输出直接当产品红灯或产品通过项。默认 suite 包括 runner 自测，不允许静默跳过。

## 必须主动证伪的项目

- 认证：route 不可绕过 Connection admission；无 cookie、假 cookie、外部 Host/Origin、cross-site 标记不能到适配器；合法会话能读；HEAD 不触发上游。
- 异常：多行 key、credential store 异常、Node header 错误、适配器异常、Codex stderr 不能把虚拟秘密交给浏览器或日志。
- 数字：null/空串/bool/缺字段/超范围不能成为 0 或 100%；真 0% 与金额混合时不丢额度。
- 进程：完整握手、初始化拒绝、异步 EPIPE、退出、超时、停止中取消、最多三个技术候选；真实 Windows cmd 包装器有普通、空格和括号路径用例。
- 缓存：同一激活单飞，HTTP 不 spawn，旧读数明确标旧，不同激活互不污染，退出登录不保留旧订阅读数。
- 安装：只有合成临时 profile；BOM/LF/CRLF/无末尾换行/中文及尾部注释精确往返；重复操作幂等；破损标记拒绝；空流列表拒绝且不变；用户拥有的联接不删；失败回滚。
- 发布：固定版本 spec `github:Ronniealgo/dsh-route-balance#v0.6.2` 与实际包名严格一致，不用 includes 子串匹配；实际 npm tarball 需要完整导入闭包和安装工具；解包后真实 import 而不 apply；CHANGELOG、版本、生成 ID 一致。
- 诚实验收：没有插件、HTTP 0/404、认证缺失不能得到 live PASS；源码/产物不一致不能以 skip 掩盖。
- 公开表述：不得声称已被插件市场收录、获得 DSH 官方背书，也不挂未经验证的徽章；npm 安装命令和 npm 发布事实都不得出现（npm 包尚未发布）。

## 官方库隔离集成

若本机已有相应 DSH 模块，设置 `DSH_ROUTE_BALANCE_SDK_PACKAGE` 为它们的依赖解析锚点，再运行：

```bash
node test/host-auth.integration.test.mjs
```

测试用官方 Cordis、Connection、认证 cookie 和 HTTP 桥实现，但只使用内存中的测试 grant 和临时 loopback 端口，不提供真实服务凭据，不重启正在运行的实例。未提供官方模块锚点时明确标未验证。

## 明确不等于已完成的验证

- 离线组件不是实际浏览器截图或完整 GUI 安装证明。
- Windows 本机通过不等于 Ubuntu、所有 Node 版本、远程 CI 已通过；CI 文件虽已定义 Windows/Ubuntu × Node 20/22/24 矩阵，但远端尚未执行，属于待跑项。
- 虚拟供应商响应不等于本候选已真实读过每家余额。
- 旧版真实读数不证明本版的 live 行为；历史截图/旧快照也不能复用为新证据。
- snapshot 是手工历史数据，不能证明当前账号身份。

真实环境验证只有用户具体同意后才执行。[live 工具](../tools/verify-live.mjs)需要显式 cookie；[quota 工具](../tools/codex-quota.mjs)默认不写快照，但真实 Codex 自己可能写运行时状态。

## 报告要求

给出：实际命令、退出码、通过/失败/跳过数、复现输入、改动 diff 检查、受控与真实环境的区别、无法验证项、必须修的剩余反例。不要公开真实 key/cookie、账户原文、个人绝对路径或私有日志。

公开仓库确定为 <https://github.com/Ronniealgo/dsh-route-balance>。本地旧历史保留用于审阅；上传旧历史或改写历史是另一个需要批准的操作。发布身份和 URL 不得编造，也不得把另一个项目的署名套到这里；参考 [PUBLISHING](PUBLISHING.md) 和 [SECURITY](../SECURITY.md)。
