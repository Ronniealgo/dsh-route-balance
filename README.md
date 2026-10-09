# dsh-route-balance

**0.6.2 实验版**：在 DeepSeek Harness 的侧边栏显示配置过的 API 路线余额和 ChatGPT/Codex 订阅剩余额度。

> **实验候选（pre-release）**：公开仓库目标是 <https://github.com/Ronniealgo/dsh-route-balance>，0.6.2 在 GitHub Release 上按 **pre-release** 标记。上传与打标签的状态以该 GitHub 仓库为准，本文不代为宣称“已经发布完成”。既未被插件市场收录，也没有 DSH 官方背书，不挂未经核实的徽章。接口、配置默认值和 Codex 接触面仍可能在后续实验版里变化。

示例（演示数字，不是本轮真实账户读数）：

```text
● ¥12.90 · $13.14 · ¥0.10 · GPT 剩 49%
```

悬停查看每条路线的明细和失败原因。真实的 0% 会显示；读不到的值不会冒充 0 或 100%。旧读数标为“（旧）”。

## 要求与安装边界

- Node.js 20 或以上；插件没有运行时 npm 依赖。
- DSH 至少 0.2.0-rc.2，并提供 Connection 的认证 Fetch 注册接口。版本字段不是未来版本兼容性的保证。
- 公开仓库来源是 <https://github.com/Ronniealgo/dsh-route-balance>；0.6.2 是 GitHub pre-release 实验版，安装推荐固定版本，不要跟随浮动的分支名。
- **npm 包尚未发布**：当前按 GitHub 固定版本安装，不要按 npm 包名安装。DSH 的包管理器仍可能访问 npm 来解析所选 profile 的依赖。
- 文档里的安装命令、市场入口都不会自动装到你的机器上：命令要你自己在终端执行，市场“添加插件”也只是在插件页粘贴 spec 并确认信任。
- 本版没有安装到用户正在运行的 DSH，没有改真实凭据或重启实例。离线组件渲染测试不是实际浏览器视觉验收。

## 安装

运行时库已经在本版本仓库里生成好，**不需要**先 build、也不需要安装测试专用 YAML 解析器就能使用（开发与测试才需要，见 [开发与验收](#开发与验收)）。

按实际使用的 profile **选择一条**安装命令，不要两条都执行。

### DSH 桌面版

```bash
dsh plugin --profile desktop add "github:Ronniealgo/dsh-route-balance#v0.6.2"
```

### DSH Web

```bash
dsh plugin --profile web add "github:Ronniealgo/dsh-route-balance#v0.6.2"
```

两条命令只选择 profile，不影响插件行为；不确定自己是哪一类就先看 DSH 的 profile 名称再执行。`#v0.6.2` 是固定标签，换版本时必须显式改写。

也可以在 DSH 的“插件 → 添加插件”中粘贴下面的 GitHub 来源，按界面提示确认信任并点击安装：

```text
github:Ronniealgo/dsh-route-balance#v0.6.2
```

勾选信任本身不执行安装；点击安装后，DSH 会下载插件并写入你选择的 profile。安装或更新后按界面提示重启 DSH、刷新页面，不会替你安装到其它 profile。

[安装入口](install.ps1)支持 PowerShell 5.1 和 7，适用于离线或源码目录安装。以下命令**会改目标 profile**，只在用户同意安装后执行；`-DshHome` 可指向独立测试目录：

```powershell
pwsh -File install.ps1 -DshHome <目标DSH目录> -Profile desktop
pwsh -File install.ps1 -DshHome <目标DSH目录> -Profile desktop -Uninstall
```

安装器使用目标 profile 已有的 YAML 解析器，不从另一个真实 profile 偷找依赖。它备份配置原始字节，追加有首尾标记的自有块，并记录归属；卸载只移除这个块、必要时补加的换行和自己创建的联接。BOM、LF/CRLF、用户注释和末尾换行状态保留。用户后续新增内容也保留；受管理块损坏、归属无法确认时拒绝删除。

空流式序列 `[]` / `[ ]` 安全拒绝（退出码 3），不静默改写。旧版无管理标记的插件行不自动接管。已有正确联接若原本属于用户，卸载不删除；被别的目录占用时停止。失败尽量回滚本安装器的变更，安装锁阻止两个本安装器同时写配置。中断或手工编辑后的异常情况请先检查备份和记录，不要强删用户内容。

## 配置

```yaml
- insert:
    - id: route-balance
      name: "dsh-route-balance"
      config:
        slot: sidebar.footer.action
        refreshMs: 300000
        requestTimeoutMs: 15000
        cacheMs: 10000
        codex:
          strategy: auto
          warmMs: 240000
          timeoutMs: 20000
          snapshotPath: null
```

| 配置 | 含义 |
|---|---|
| `slot` | 默认侧边栏底部；也可选 DSH 已声明的其它槽位 |
| `refreshMs` | 页面轮询间隔，默认 5 分钟，最小 1 分钟 |
| `requestTimeoutMs` | 每条供应商读取总时限，默认 15 秒 |
| `cacheMs` | host 余额短缓存，默认 10 秒；并发请求共用一次读取 |
| `codex.strategy` | `auto` 后台读取；`snapshot` 只读手工快照；`off` 隐藏且不读 |
| `codex.warmMs` | 额度后台读取间隔，默认 4 分钟，最小 30 秒 |
| `codex.timeoutMs` | 一次额度读取的总候选时限，默认 20 秒 |
| `codex.snapshotPath` | 可指定快照；默认按 `CODEX_HOME` 或用户 Codex home 查找 |

网页接口固定为 `/api/dsh-route-balance/balances`，不再支持自定义 `path`。点击刷新只重新请求页面数据，可能仍使用短缓存；额度不会因为点击额外启动进程。

## 数据来源

| 路线 | 读取方式 |
|---|---|
| DeepSeek 账号 | DSH 的账号 Remote；缺少账号服务时只这一条不可用 |
| DeepSeek API Key | 官方 `/user/balance` |
| OpenRouter | 官方 `/api/v1/credits` |
| 智谱 | 账户余额报告接口 |
| 小米 MiMo | 尝试 `usage`、`quota`、`balance` 三个候选；候选失败只说明当前探测不可用，不证明全部公开 API 不存在 |
| ChatGPT/Codex | 本机 Codex app-server 的账户和额度协议，不发送推理请求 |

API Key 只在 host 使用：通过 DSH 的凭据解析服务、宿主进程环境变量、Windows 命名用户环境注册表值顺序查找。**凭据服务拒绝时失败，不绕过拒绝去找其它来源**。默认命名为 `DEEPSEEK_API_KEY`、`OPENROUTER_API_KEY`、`ZHIPU_API_KEY`、`MIMO_TOKEN_PLAN_API_KEY`。宿主不把异常原文、Codex stderr 或已解析密钥返回页面；新增适配器也必须遵守这个边界。

## Codex 的真实接触面

默认 `auto` 会在后台启动本机 `codex app-server --listen stdio://`，执行 `initialize → initialized → account/read → account/rateLimits/read`，随后终止进程。请求只读取账户额度，不请求模型推理。

**插件不直接读取 auth.json，但 Codex 自己会使用自己的配置/认证，并可能写入运行时数据库、日志及其它状态，也可能发起认证/账户网络请求。不能把启动 Codex 描述为“整个进程只读”。** 不希望启动它时使用 `snapshot` 或 `off`。

每次激活拥有独立缓存和一条在途读取。首次尚无读数显示“读取中”；失败保留该激活的上次成功值并标旧，超过三个后台间隔未刷新也标旧；未登录或 API Key 账户会清除此前订阅读数。额度主显示选剩余最少的窗口，重置时间跟随同一窗口。

快照经过时间、版本及百分比校验，但仍是**用户提供的历史数据**，不是当前账号的实时认证证明，界面始终标旧。

[额度诊断工具](tools/codex-quota.mjs)默认不写快照；明确指定写入才保存：

```bash
node tools/codex-quota.mjs --json
node tools/codex-quota.mjs --write
node tools/codex-quota.mjs --out <快照路径>
```

`--no-write` 保留为废弃的无操作别名。即便不写快照，真实 Codex 自己仍可能写状态。

## 开发与验收

修改[模板](src/client.bundle.js)、[金额模型](lib/core.js)、[来源与轮询](lib/registry.js)，然后生成[浏览器产物](lib/client.js)。不要手工改产物。

安装测试需要**测试专用** YAML 解析器，插件的运行时依赖仍为零。可离线指定已安装解析器的 `package.json` 到环境变量 `DSH_ROUTE_BALANCE_YAML_PACKAGE`；或准备测试依赖：

```bash
npm install --no-save --ignore-scripts --legacy-peer-deps --package-lock=false yaml@2.9.1
node tools/build-client.mjs
node tools/build-client.mjs --check
node tools/check-package.mjs
node tools/run-tests.mjs
```

文档中的相对链接按配套源码包组织；运行时 tarball 不包含开发用的 src、test、docs 目录。

整套使用合成账户、隔离配置和进程，禁止真实凭据文件、注册表及外部网络调用。CI 定义 Windows/Ubuntu × Node 20/22/24 矩阵，但本地运行结果不冒充远程 CI 结果。

若明确设置 `DSH_ROUTE_BALANCE_SDK_PACKAGE` 指向本机 DSH 的依赖锚点，还会运行官方 Connection、cookie 和 HTTP 桥的隔离集成；未提供时该项明确标未验证。

[真实接口检查工具](tools/verify-live.mjs)仅在**另行同意真实验证后**使用。需明确设置 `DSH_BROWSER_COOKIE`，脚本不读凭据库、不自行生成认证。缺 cookie 返回未验证；插件 404、HTTP 失败或坏响应不能通过。该工具验证 host 和生成组件契约，不是完整真实浏览器证明。

详情：[机制](docs/PLUGIN-ANATOMY.md)、[安全边界](SECURITY.md)、[发布检查](docs/PUBLISHING.md)、[第三方验收入口](docs/HANDOFF-VERIFICATION.md)。

## 发布状态与已验证范围

- **已验证**：160 项测试在 Windows / Node 24 的隔离环境通过，覆盖官方库、合成认证与真实合成进程；这些测试不触真实 GUI，不触真实供应商账户。
- **实机范围仍未验证**：真实浏览器图形界面渲染、真实 DSH 安装与真实供应商账户读数尚未验证。
- **跨平台结果单独看 CI**：CI 文件定义 Windows 与 Ubuntu × Node 20/22/24 矩阵；当前源码 SHA 的执行结果请查看 [GitHub Actions](https://github.com/Ronniealgo/dsh-route-balance/actions)。本地 Windows/Node 24 的通过不替代其它环境的结果。
- 本仓库未声明已被任何插件市场收录，也没有 DSH 官方背书。

## 许可证

保留原项目的 [MIT 许可证与署名](LICENSE)。署名保持原样，不虚构作者、真实邮箱或其它项目的署名。维护者只链接 GitHub 账号 [Ronniealgo](https://github.com/Ronniealgo)。
