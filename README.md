# UNFORM 4.0 — FUSION & Interactive Geometry

通过动作塑造生成式数字材料的黑白交互作品。GEOMETRY 从正八面体开始，FUSION 3.0 将本地图片的轮廓、明暗、视觉重心和多尺度密度场转译为三维点线面结构；两条路径进入同一个 CREATE 空间，复用 Canvas 2D 三维投影、SCULPT / VIEW、触控与可选摄像头输入。

## 4.0 功能与验收状态

- **GEOMETRY / FUSION**：默认几何入口与本地图片导入、预览、裁切、分析、重新生成均已开放。图片和视频只在当前浏览器处理，不上传到服务器。
- **Density Field**：保留图像驱动的疏密、轮廓和负空间，以隐性八面体方向、局部斜向连接、共享节点的稀疏三角面和前后深度建立三维结构，不显示完整预设八面体外框。
- **SCULPT / VIEW**：慢拖塑形，有效塑形后松手自动留痕；VIEW 拖动只观察。连续快速滑动打散后回到已保存形态，不新增留痕历史；Undo / Restore 分别撤销最近留痕和恢复当前作品初始形态。
- **双作品状态隔离**：GEOMETRY 与 FUSION 分别保留粒子、留痕、撤销和观察状态，切换不覆盖另一件作品。状态仅保存在当前页面会话，刷新或关闭页面会丢失；尚未提供作品文件持久化或静态图片保存。
- **性能与动态**：保留 FLOW / FRAGMENT / TRACE、55% 解构强度、65% 惯性、移动端自适应粒子/DPR/拖尾预算，以及 Worker 优先、串行推理和失败回退。

发布前自动化基线为 **215 项测试**，生产构建和 `/UNFORM/` 静态资源检查通过。受控 Chromium 检查覆盖桌面和手机视口，不能替代手机硬件验收。用户已通过 Cloudflare 手动预览验证 GEOMETRY、FUSION、SCULPT、VIEW、松手留痕、Undo 和连续快速滑动打散；最近确认斜向连接与空间顶点可见，三维厚度仍稍扁，本轮接受并保持算法不变。全部交互的最终真机回归尚未完成。

**摄像头手机/平板真机验收仍待完成。** 本次按用户决定先提交 4.0 发布 PR，后续补测真实张掌/握拳、快速反向、持续交互、Worker 回退及性能。云端 Chromium 曾因模型下载证书信任错误无法完成真实推理；摄像头不可用时仍保留鼠标/触控。测试通过不表示摄像头已在目标真机验收，也不表示 4.0 已合并或部署到 GitHub Pages。

## 4.0 ORIGIN / GEOMETRY 入口

首次打开 `/UNFORM/` 显示 **HOW WILL YOUR FORM BEGIN?**。GEOMETRY 是默认入口，第一次点击创建正八面体粒子场并进入 SCULPT；FUSION 打开本地图片选择、预览与裁切，确认后进入 TRANSLATE。分析和生成完成后，用户进入 CREATE / VIEW，再按需切换 SCULPT。

CREATE 底部 **← ORIGIN** 和顶部 UNFORM 标识均可返回。有留痕、编织或其他形态修改时先确认；取消则继续创作。确认返回仍保留当前标签页的作品和观察状态，暂停模拟、取消活动输入并关闭摄像头。再次选择 GEOMETRY 继续同一作品，需要新的有效触控或手势，摄像头需主动重新开启。不会重新初始化粒子或自动 Restore。

记忆尚未持久化，刷新或关闭页面仍会丢失。ORIGIN 在小屏与横屏可纵向滚动；CREATE 延用原有响应式布局、55% 解构强度、65% 惯性、SCULPT/VIEW、IMPRINT、Undo 和 Restore。GitHub Pages 和预览 Artifact 配置不变。

## 4.0 创作空间：SCULPT / VIEW

独立开发分支 `feat/unform-4-sculpt-view` 包含本次 4.0 更新，沿用现有渲染引擎，以模式和统一输入边界保护作品。

- GEOMETRY 默认 **SCULPT**，FUSION 生成后从 **VIEW** 进入；切换 SCULPT 后可使用原有鼠标/触控塑形、编织、撕裂、多点触控、手势预响应、形态与参数控制。
- 点击 **VIEW** 保持当前形态；用鼠标或一根手指拖动观察三维作品，暂停动画时也可观察。此时停止形态模拟及自转，形态按钮、解构滑块与 Reset 禁用，摄像头识别继续运行但不写入作品。
- 切换会结束活动输入并释放指针捕获，保留形态与观察角度。返回 SCULPT 后等待新的按下操作、显式编辑操作或切换后采集的有效手部结果；旧拖动、旧确认状态及在途推理结果不会跨模式继续塑形。
- 观察时固定当前可见粒子预算以保持快照一致；性能诊断继续更新。SCULPT 恢复输入后继续原有自适应质量策略，粒子/DPR/TRACE 预算与推理频率配置不变。
- 运行 `npm run dev`，打开终端显示的 `/UNFORM/` 地址预览。摄像头沿用 HTTPS/localhost 限制。

当前完整测试套件覆盖模式切换、暂停观察、输入结束与重新开始、摄像头在途帧隔离、手机横竖屏尺寸以及生产资源路径。真机状态以本 README 顶部的 4.0 验收说明为准。

## SCULPT 2.2：慢拖留痕，快划打散

在正八面体上慢速拖动，保持 SCULPT 2.1 的增益、范围和弹簧响应；正常松手立即提交一条 IMPRINT。快速滑动进入互斥的 SCATTER：按 CSS 像素速度约 420px/s 和至少 6px 连续方向位移判定，触控与鼠标共用。高频小步事件可累计识别；极小抖动不能触发。一次触控只要进入打散，之后即使变慢或停顿，松手也不会留痕；下一次重新按下才能塑形保存。

打散沿路径局部断线，给粒子瞬时速度后由现有惯性扩散、回聚，始终保留已有局部形态记忆及历史。最初触发立即处理，后续全粒子扫描按约 16ms 限流并在松手补齐末段，避免高频触屏事件重复扫描。参数集中在 `src/sculpt-input.js`，55% 解构、65% 惯性不变。VIEW 只观察，Undo/Restore、ORIGIN 和摄像头仍沿用原逻辑。

## Cloudflare 专用预览包：明确区分两层 ZIP

工作流仍只在 `feat/unform-4-sculpt-view` 推送时生成 Artifact，不自动部署。需要 Python 3 进行打包及相关测试（GitHub Ubuntu runner 已提供）。`npm run build` 后，工作流执行 `python3 scripts/package-preview.py --source dist --output <输出目录>/UNFORM-Cloudflare-preview.zip`。

手机操作：

1. 登录 GitHub，进入对应提交的成功 Actions 记录，下载单个 **UNFORM-4-sculpt-view-static-preview** Artifact。外层通常为 `UNFORM-4-sculpt-view-static-preview.zip`，不要使用下载全部 Artifacts 的总包。
2. **只解压外层一次，取出内层 `UNFORM-Cloudflare-preview.zip`。上传这个内层 ZIP 原文件**，不是外层 Artifact ZIP，也不是手机解压工具生成的同名文件夹。内层不需要重命名；不依赖 ZIP 名称自动创建目录。
3. 在 Cloudflare Pages 手动上传前后核对文件树，站点根必须直接有 `_headers` 和 `UNFORM/`，后者内部包含 `index.html`、`assets/`、`hand-worker.js`、`mediapipe/`、`preview-version.json`。若上传器额外套目录，应改为上传解压后的站点根内容（`_headers` 与 `UNFORM/` 一起）或使用电脑上传；不要在错误目录树下继续发布。
4. 发布后打开 `https://<你的项目>.pages.dev/UNFORM/`。现有项目的目标地址为 `https://unform-4-preview.pages.dev/UNFORM/`；这里是操作目标，不表示本轮已经部署验证。
5. 打开 `/UNFORM/preview-version.json`，核对 `commit` 与所选 Actions SHA 一致。记录还包含构建时间及资源 SHA-256，帮助区分旧部署和旧缓存。本地未提交打包标记为 `local-working-tree`。

真正上传包的目录结构：

```text
UNFORM-Cloudflare-preview.zip
├── _headers
└── UNFORM/
    ├── index.html
    ├── assets/                     # 带内容哈希的 JS/CSS
    ├── hand-worker.js
    ├── mediapipe/                  # vision_bundle.mjs、SIMD/非 SIMD WASM/JS
    ├── favicon.svg
    └── preview-version.json
```

打包器检查 ZIP 完整性、所有文件字节、唯一站点根结构、HTML 的 `/UNFORM/` 资源引用、哈希入口、动态模块、Worker 和 WASM 文件及内容。文件缺失、JS/WASM 实际为 HTML 回退、错误 base 时构建会失败。本地 HTTP 验证可检查实际 MIME；最终 Cloudflare 的响应类型和目录仍需部署后检查，不能只看 200。JS 应为 JavaScript、CSS 为 `text/css`、WASM 为 `application/wasm` 且以 WASM 魔数开头，不能返回 HTML。

### 预览缓存规则与排查

专用包根目录的 `_headers` 来自 `scripts/cloudflare-preview.headers`，依据 [Cloudflare Pages 官方 Headers 规则](https://developers.cloudflare.com/pages/configuration/headers/)：它对静态资源响应生效，不适用于 Pages Functions。`/UNFORM`、`/UNFORM/`、`/UNFORM/index.html`、`/UNFORM/preview-version.json` 采用 `Cache-Control: no-store`；仅 `/UNFORM/assets/*` 的哈希资源采用一年 immutable 缓存；固定名称的 Worker、favicon、MediaPipe 采用 `no-cache`，允许缓存但每次重新验证。WASM 和本地 MediaPipe 模块额外声明正确 MIME。规则没有把整个 `/UNFORM/*` 缓存为 immutable，避免固定名称文件长期过期。

这些规则只写进 Cloudflare 内层 ZIP，**不写入 `dist` 或 `public`**，不修改 Vite base 或正式 GitHub Pages 工作流。新响应头无法追溯清除浏览器已存的旧 HTML；更新后可先用 `/UNFORM/?v=<本次提交SHA>` 测试，再刷新或清理该站点缓存，并核对版本 JSON。项目没有注册 Service Worker；仍需确认 Cloudflare 仪表盘是否存在额外 Cache Rules/旧部署、手机是否上传了正确 ZIP。普通窗口与无痕结果不同并不能单独证明根因，不能以“改名 ZIP”替代这些检查。

本地测试不等于 Cloudflare 实际执行 `_headers`。手机上传解压目录、真实 HTTPS 响应头、浏览器旧缓存清理和账号级缓存规则都必须上线后验证；本轮不部署、不宣称线上问题已解决。

## SCULPT 2.1 塑形表现力

保留松手立即留痕。针对短拖动，局部拖动增益由 1 提至 1.35，影响半径由 0.55 调至 0.62，按住时的弹簧速率由 1.3 提至 1.8；松手速率仍为 1.3。沿用中心强、边缘平滑归零的平方衰减场，粒子、FLOW 与骨架共用。60% 留存比例、0.32 拖动上限、0.24 总偏移上限、55% 解构及 65% 惯性不变。

误触门槛仍为 8px 净拖动和 3px 预计留存位移，使用增益前的物理位移判定。历史及 Undo 在松手时立即更新，成功文字在残余位移小于约 0.6px、速度低于约 3px/s 后显示 0.9 秒；新操作、Undo/Restore、模式/页面切换会取消旧提示，不阻塞输入。全部参数集中在 `src/imprint.js`，未引入额外渲染循环、依赖或粒子特效。手机实际触感与持续性能仍需真机验证。

## 4.0 IMPRINT 2.0 松手留痕

SCULPT 下在雕塑上有效拖动后正常松手即提交 IMPRINT，不再等待 3 秒。点击、净位移不足约 8 CSS px，或预计留存形变小于约 3 CSS px 时不创建历史；形变阈值按投影尺度计算，不随粒子数或 DPR 改变。保留约 60% 的拖动目标，提交时转移持久层与弹性层位移并保留速度，避免跳变或弹回原始形态。鼠标主键复用同一 pointer 路径。

原始坐标保持不变；独立的物体空间局部位移场同时作用于粒子、棱线 FLOW 和编织骨架。偏移有范围和幅度限制，保留 55% 解构强度、65% 惯性及原有摄像头路径。VIEW 冻结观察且不提交留痕；返回 SCULPT 需要新输入。切换形态保留正八面体记忆，其他形态不应用它。

停止明显移动约 0.55 秒会出现一次低透明度白色环形脉冲，0.45 秒后消失；仅为反馈，不写历史，不是保存条件。多次停顿不创建历史，正常松手最多提交一条。SCULPT 2.2 中快速滑动改为不保存的 SCATTER；慢拖仍无需等待。

控件 ↶ / **Undo last imprint** 撤销最近一次已完成留痕；原 Reset 图标现为 **Restore original form**，清除全部记忆并恢复初始形态。两者在 VIEW 禁用。取消/失去指针捕获/切换 VIEW/返回 ORIGIN 不会提交未完成留痕，已完成留痕不因此删除。任何多指参与会取消整次连续触控的提交资格，最后一根手指松开也不保存；全部抬起后新单指操作才能留痕。摄像头仍只驱动已有动态，不生成触控留痕历史。

参数集中在 `src/imprint.js` 的 `IMPRINT`。当前最多 24 次留痕、4 个活动输入及最多 24 个回弹缓冲，仅单指拖动可提交；每次按下最多提交一次。记忆只存在于当前页面会话，刷新会丢失，尚无作品持久化。暂停动画时不累计停顿反馈；正常松手提交不依赖动画帧。达到 24 次上限后需先 Undo 或 Restore 才能继续新增留痕。安卓真机的可见度、误触和长时间性能仍需验证。

## 历史实现记录：3.2.3 连续直接响应

以下 3.x 章节保留当时的实现背景、阶段测试数量与局限。当前交互和验收状态以顶部的 4.0、SCULPT 2.2、IMPRINT 2.0 和 FUSION 3.0 说明为准。

基于 main `c80f5fa`，修复“预响应 → 回退 → 正式响应”的双重位移。原先把正式分层进度与快速消退的附加位移相加；现在预响应直接推进同一组分层弹簧，确认只改变目标，保留位置与速度。等待正式启动的层保持/接近预响应位置，不返回初始形态。移除确认后的额外 180ms 目标锁存，已确认状态仍保持至明确反向或持续失去追踪；短暂 unknown/no-hand 保留最近可信意图。

即时预响应、约 80ms 确认、FRAGMENT 分层时序、55% 解构与 65% 惯性均保留。`quickFeedback` 只保留亮度提示，不再参与粒子坐标。手机提示使用已确认状态，提示区固定高度，仅稳定显示文案，控制结果仍立即传给动画。

`npm test`、生产构建及 90 项展开用例通过，新增同方向位移连续性、确认时位置/速度不重置、实际粒子投影及提示稳定性测试。浏览器回归与 `/UNFORM/` 生产资源检查通过，仍需手机和平板真机验收。完整复现数据与局限见 [直接响应修复记录](docs/direct-response.md)。

## 3.2.2 动作保真与平板识别

以下为上一版本记录；180ms 目标锁存和独立几何预响应通道已由 3.2.3 的同状态交接替代。

基于 main `cbb1e69`，保留 3.2.1 的 Worker、手机粒子预算、TRACE 采样、DPR、自适应输入和串行推理。55% 解构、65% 惯性及识别阈值不变。

- 恢复 FRAGMENT 门控后丢失的有界几何预响应；确认后的 0/1 完整目标与预响应、手掌位置显式分离，反向预响应期间正式分层目标继续推进。确认目标短时锁存 180ms，只保留最新反向目标，不排队播放动作，也不等待整段动画结束。
- 短暂丢帧保留目标，宽限按实际推理间隔取 350–750ms，且不会被空结果无限续期；持续丢失或摄像头停转后释放。单帧噪声仍不能触发完整解构；两个相符样本和约 80ms 的确认要求保留。完全落在两个采样之间的动作无法凭空恢复。
- 移除位置的重复低通滤波，保留渲染弹簧；快速移动驱动有界旋转、局部扰动与短时 TRACE 能量。分层开始时间按真实 dt 跨界积分，低 FPS 不再被固定 50ms 步长减速。
- 平板等待有效尺寸和视频帧再取图；保持视频原始宽高比，不重复裁剪、旋转或镜像。通过实际能力检测选择 Worker，初始化失败、运行错误或超时后串行回退；有效空检测结果不会盲目触发后端切换。浏览器视频帧回调停滞时改用 RAF 检查新视频时间。
- `?debug=performance` 新增已确认手势、目标解构、三层实际解构、摄像头/模型/推理独立状态、后端、尺寸、视频时间、实际 facingMode、最后成功检测时间及错误/回退原因。`?debug=gestures` 保留。

根因对比、测试结果和真机验收范围见 [3.2.2 修复记录](docs/motion-fidelity.md)。这些代码和模拟/浏览器检查不等于安卓手机或平板真机验收，未发布或自动合并。

## 3.2.1 手机性能优化

基于 main 的 3.2，保留 FLOW / FRAGMENT / TRACE、55% 解构、65% 惯性和 3.1.1 快速预响应。视觉性能参数集中于 `src/performance.js`，识别输入预算集中于 `src/inference-quality.js`，完整测量条件和局限见 [性能记录](docs/mobile-performance.md)。

- 手机默认显示 **595 个粒子**（原 850，减少 30%），保留原始粒子池；每档严格维持约 35/45/20 的外密内疏分布和 12% FLOW 比例。持续压力下逐档降低至 510/425，性能恢复后缓慢提升至 722/850。降档需持续约 2 秒，升档需约 8 秒，切换冷却 4 秒，粒子以约 450ms 渐入/渐出，不重建渲染循环或粒子对象。
- 手机编织线按透明度和虚实样式合批，最多 12 次 `stroke()` 提交；桌面保留逐线绘制。手机 TRACE 历史由 7 个采样降为 4 个，潜在线段数从 6 降为 3；最低档进一步降低轨迹线段和淡面数量。DPR 继续最高 1.5，旋转屏幕时按新尺寸设置 backing canvas。
- 在支持 Worker、OffscreenCanvas 和 ImageBitmap 的设备上，将真实 MediaPipe CPU 推理放入独立 Worker。只有一帧在途，不排队旧帧；不支持或初始化失败时回退原主线程路径。关闭摄像头、切后台或离开页面会终止 Worker 和释放视频帧。保留最高 30Hz 和 80ms 确认目标，首个可信结果立即预响应。
- 根据安卓摄像头开关对比结果，优先控制识别负载：手机请求 480×360 / 30fps 视频，通过复用的 Canvas 按原比例输入，最长边在 480/384/320/256 间自适应，桌面保持最高 640。不反复协商摄像头流；设备实际输出可能不同，以诊断面板为准。调度参考含取帧和传输的完整往返耗时，Worker 不额外叠加空等；阻塞回退保留原有空闲余量。压力持续 500ms 才降输入，恢复需约 8 秒，冷却 1.5 秒。识别预算仍可下降时，低 FPS 本身不会触发粒子减量；粒子自身绘制过重仍可降档。
- 新增 **`?debug=performance`**，分别显示渲染 FPS、推理频率/模型耗时、取帧及 Bitmap 耗时、取帧至结果总耗时、实际输入/视频尺寸、调度间隔、在途任务数，以及粒子与渲染指标。`?debug=gestures` 仍可用。总耗时从开始取帧计时，不是摄像头曝光到屏幕发光的延迟；Worker 耗时不能直接与主线程绘制耗时相加。

安卓真机仍需验证：持续帧率、功耗和发热、不同 Chrome/机型的 Worker 支持与回退、真实手部追踪精度和预响应、质量渐变观感、精简拖尾可见度。受控 Chromium 测量不是安卓硬件结果。

## 3.2 FLOW · FRAGMENT · TRACE

本版基于最新 main 的 3.1.1，继续使用现有 **Canvas 2D 三维投影**（仓库没有 Three.js），复用唯一渲染循环和粒子数据。新参数集中在 `src/flow-state.js` 的 `FLOW_STATE`；55% 解构与 65% 惯性仍由 `src/motion.js` 定义。

- **FLOW**：精确选取约 12% 总粒子，全部来自原有棱线粒子，沿 12 条现有棱平滑往返；各自速度、相位和方向不同。轻微亮度感变化来自点面积的小幅变化，不增加辉光。其余 88% 不参与明显棱线流动，外密内疏比例不变。编织时流动粒子仍可被局部细线吸附。
- **FRAGMENT**：顶点附近粒子→其余棱线/表面粒子→内部粒子，每层以 80ms 错开解构；握拳按内部→棱线/表面→顶点的相反顺序重构。层级由原始几何归属固定划分。正式波从确认目标开始；3.1.1 的独立即时预响应不受分层等待影响。新目标会替换未完成阶段，弹簧保留当前状态和速度，不使用 setTimeout 排队动画。
- **TRACE**：仅快速手掌位移触发局部轨迹和轻微旋涡，静止、手丢失或采样过期后停止发射并淡出。桌面最多约 4% 粒子、12 个历史采样；手机约 1.8%、7 个采样。历史保存当时的三维场景位置与深度，包含雕塑旋转和手掌引导的平移，绘制时不会再次跟随当前物体姿态而抹掉拖尾。单个轨迹采样在 450ms 内衰减为零；停止运动后不再无限续尾。切换形态或复位会清理轨迹。

轨迹位置、时间、权重和索引采用预分配 TypedArray 环形缓冲；投影复用每粒子的三维缓存，并将旋转三角函数移至逐帧一次计算。没有增加摄像头推理循环，也没有改动确认窗口、推理调度或位置滤波。

仍需手机真机验证：棱线流动与编织的视觉协调、分层错开与反向切换的体感、快速手掌在不同光照下的局部轨迹可见度、0.3–0.6 秒尾迹观感、手机帧率/发热，以及真实摄像头预响应延迟。模拟关键点和浏览器自动化不能代替这些验证。

## 3.1 最终动态参数

集中配置位于 `src/motion.js` 的 `MOTION`：`deconstructionStrength: 0.55`、`motionInertia: 0.65`、`dynamicStyle: 'C'`。界面初始化与复位均读取这里，不再分别硬编码默认值。

- **55% 解构强度**是效果幅度，不是静止时的激活量。它同时控制扩散距离、局部断裂程度和几何锚点保留比例。C 混合型将约 45% 的棱线锚点/网格连接作为结构保留，其余部分随激活量连续解构，兼有几何骨架与流动碎片。滑块可实时调整强度。
- **65% 运动惯性**控制阻尼弹簧的响应，以及滑动扰动和断裂的恢复速度。它使释放后渐进减速，产生轻微有界回弹；不是固定 650ms 的延时。
- **张掌 / 握拳**：张掌持续驱动解构。3.2 正式波按顶点→棱线/表面→内部解构，并按相反顺序重组；任何时刻都可通过新手势改变目标，并保留当前速度。
- **静止**保持缓慢自转和轻微流动；没有手势时不会仅因默认值为 55% 就持续炸开。双指、旧形态的按住扩散及正八面体局部编织/快速滑动均保留。系统减少动态效果设置仍默认暂停。

## 3.1.1 手势启动延迟优化与调试

排查旧代码发现固定约 83ms 的推理间隔（约 12Hz），以及推理后再次混入 60% 历史值的手势滤波；旧版没有单独的稳定确认机制。两者再叠加惯性响应，可能延迟运动起步，实际占比需真机测量。

- 优先用 `requestVideoFrameCallback` 获取新解码帧，不支持时退回 RAF；以媒体时间去重，串行推理，最高约 30Hz。根据实际推理耗时自适应降低占空比，不硬性要求低性能手机达到 30fps。
- 可信张掌/握拳趋势在首个有效推理结果即触发小幅预响应，正式目标在约 **80ms 且至少两个新鲜有效样本** 后确认。模糊姿态会取消待确认趋势，防止短暂误识别造成大幅解构。确认只能发生在新推理样本到来时，所以低帧率或慢推理时可能超过 80ms。
- 去掉额外的 openness EMA，只对手部位置做时间相关的轻量滤波。预响应包含极轻的位移与白点亮度脉冲，反向手势即使暂时被既有惯性掩盖，也有独立反馈。预响应与正式运动都保留弹簧速度，确认、取消或反向手势不会直接改写粒子坐标；55% 解构、65% 惯性和 C 混合型参数不变。
- 在 URL 后添加 **`?debug=gestures`**（例如 `/UNFORM/?debug=gestures`）显示可折叠计时面板。默认不显示；计时按 250ms 刷新，不参与动画或确认调度。

面板分别显示浏览器回调收到的摄像头帧率、实际推理频率/最近耗时、首个可信趋势到稳定确认的耗时、首个可信推理结果到动画首次提交绘制的启动延迟，以及输入派发到绘制的耗时。动画启动使用正式变形或独立预响应通道的约 0.5 CSS 像素等效状态变化代理，排除静止自转与原方向的惯性运动；**不是硬件曝光、用户真实动作到屏幕发光的端到端测量**。没有手、已处于目标状态、暂停或未达到阈值时可能显示 `—`。3.1.1 的推理在主线程；3.2.1 优先使用 Worker，回退到主线程时，低性能手机的推理阻塞仍可能限制响应。

真机验证建议：在正常光照下分别连续张掌、握拳和快速反向，记录上述指标；同时观察预响应是否过强、误识别率、摄像头实际帧率及发热。测试模拟数据与浏览器不能代替真实手机摄像头测量。

## OCTAHEDRON / 001

正八面体有 6 个顶点、12 条等长棱、8 个等边三角面。粒子按约 **35% 棱线 / 45% 表面 / 20% 内部** 分布（数量取整）；内部粒子轻微漂移，外部以细小白点和少量微型菱形、三角碎片为主。

触点附近的表面粒子逐渐吸附到三角网格细线上。编织波按表面图的距离跨面传播，由虚线变成连续细线。稳定后仅允许最多 14 个极淡的小三角面；没有持续铺满整个几何体的实心面。释放后编织痕迹缓慢淡去，短触也会留下局部痕迹。快速滑动只打断附近连接、散开附近粒子，约数秒后平滑重聚；停留或再次触摸可以重新编织。只有 Octa 模式启用编织，其他形态保留原有按住扩散行为。

## 本地运行

需要 Node.js **20.19+ 或 22.12+**（推荐 Node 22/24）和 npm。

```sh
npm install
npm run dev
```

打开 Vite 输出的本地地址，默认开发路径为 `http://localhost:5173/UNFORM/`。后续复现安装用 `npm ci`。若云环境默认 npm 缓存目录不可写，可使用 `npm install --cache /tmp/unform-npm-cache`。安装会将固定版本的 MediaPipe WASM 文件复制到 `public/mediapipe/wasm/`（已忽略，不提交生成文件）。

```sh
npm test          # 几何分布、表面拓扑、编织传播/断裂恢复、手势映射
npm run build    # 生成 dist/，包含本地 WASM 资源
npm run preview  # 本地检查生产构建
```

## 当前交互

- **鼠标 / 单指触摸**：SCULPT 下慢拖局部塑形，有效形变在正常松手时留痕。停顿约 0.55 秒的轻微脉冲仅作反馈；连续快速滑动只打散、不保存。悬停不触发打散。
- **VIEW**：鼠标或单指拖动只旋转观察，不修改作品。回到 SCULPT 后需新输入；模式切换会结束旧拖动，不意外提交留痕。
- **Undo / Restore**：撤销最近一次留痕／恢复当前作品的初始形态；FUSION 恢复到本次转译结果。两者在 VIEW 禁用。
- **多点触摸**：保留原有编织与双指分散控制；多指参与会取消该次连续触控的留痕资格。系统取消触摸、窗口失焦或切后台会清理按压状态。
- **形态**：GEOMETRY 默认 Octa 正八面体，保留 Lines / Circle / Grid；FUSION 使用图像驱动的 Field 及其共享拓扑。
- **Deconstruction**：手动调整解构强度；复位恢复正八面体、55% 解构强度、65% 运动惯性，并清除编织痕迹。粒子运动继续平滑回到结构中。
- **暂停**：暂停/继续动画与编织。无控件焦点时，Space 切换暂停，1–4 依次选择 Octa / Lines / Circle / Grid。系统选择“减少动态效果”时默认暂停，需主动播放以启用动态编织。
- **摄像头**：点击 Enable camera 后才请求权限。张掌扩散，握拳聚合，移动手部控制场的位置。有效手势优先于手动扩散设置；没有检测到手时自动恢复指针/触摸控制。

## 摄像头、隐私与兼容性

使用 `@mediapipe/tasks-vision` **0.10.32** 的 Hand Landmarker，单手推理最高约 30 次/秒，按实际耗时自适应降频，默认 CPU delegate 提高兼容性。第一次启用时下载官方固定版本手模型（约数 MB）：

`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

WASM 与应用同源加载，模型需要连接 `storage.googleapis.com`。若使用 CSP，需要允许该域的 `connect-src`，并为 WASM 提供相应执行权限。加载速度受网络影响；无法下载、无摄像头或拒绝授权均保留指针与触摸交互。可关闭再重试。取消加载、关闭摄像头、切换后台及离开页面会释放摄像头；返回页面不会自动重新申请。

视频和识别均在浏览器内处理，不录制或上传视频，不请求麦克风权限。模型下载会向 Google 发起普通资源请求。

**手机摄像头必须使用 HTTPS**。桌面的 localhost 通常视为安全上下文，但通过手机访问局域网 HTTP IP 地址时，摄像头通常不可用。要测试手机手势，请使用下述 HTTPS 部署。推荐近期 Chrome、Safari、Edge；实际速度取决于设备、光照、手部遮挡和浏览器。WebView 或内嵌浏览器可能限制摄像头，请使用系统浏览器。

## 性能与无障碍

桌面最多 1,900 粒子、DPR 上限 2；窄屏或低核心设备最多 850 粒子、DPR 上限 1.5。表面网格固定为桌面 258 / 手机 146 个节点，邻接关系和粒子吸附目标只在初始化时计算，无逐帧全粒子两两搜索。后台暂停渲染并关闭摄像头。标题、雕塑与控制栏按实际布局分区，扩散粒子裁切在雕塑区域内。控件提供键盘操作、可见焦点和状态反馈；暂停状态也可静态切换形态。低性能手机可关闭摄像头，降低主线程推理开销。真实设备流畅度及真实手势识别仍需在目标手机上验收。

## GitHub Pages 部署（HTTPS）

仓库附有 `.github/workflows/deploy.yml`。`main` 更新或手动触发时，工作流执行 `npm ci`、`npm test`、`npm run build`，再将 `dist` 发布到 Pages。4.0 通过功能分支 PR 审核后发布；以下说明不表示本次更新已经合并或部署。

1. 将开发分支 PR 合并到 `main`。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 合并到 `main` 后现有工作流会自动构建部署，无需额外手动触发。只有明确需要重跑时才在 Actions 选择相应的 main 运行记录。
4. 等待 build 和 deploy 成功，从 Pages 设置或部署环境读取真实 HTTPS 地址。目标网址为 `https://qiu1112nov.github.io/UNFORM/`，以 GitHub 实际显示为准。
5. 用手机与电脑打开地址，主动开启摄像头并验证张掌、握拳及拒绝授权回退。

Vite 使用 `base: '/UNFORM/'`，CSS、JavaScript、favicon 和 MediaPipe WASM 均从该子路径加载。本地开发与预览也使用 `/UNFORM/` 路径。仓库/组织须允许 Pages 和 Actions；若权限受限可使用 Vercel。工作流只保留一个部署入口，通过 `pages: write` 和 `id-token: write` 发布，并用 `github-pages` 并发组避免同时部署。

## Vercel 部署（HTTPS）

1. 在 Vercel 选择 **Add New → Project**，导入本 GitHub 仓库。
2. 框架选 Vite，Root Directory 为仓库根目录；安装命令 `npm ci`，Build Command 为 `npm run build -- --base=/`（覆盖 GitHub Pages 子路径，适配 Vercel 域名根目录），Output Directory 为 `dist`，Node.js 选 22 或 24。
3. Production Branch 选 `main` 并点击 Deploy。无需应用密钥或环境变量。
4. 成功后使用 Vercel 显示的真实 HTTPS 地址。开发分支也可生成独立 Preview Deployment。
5. 若有访问保护，需要在 Vercel 设置中允许目标访客访问，才能作为公开作品集网址。

## 分支与合并

4.0 开发分支：`feat/unform-4-sculpt-view`。发布 PR 的 base 为 `main`，标题为 **UNFORM 4.0 — FUSION & Interactive Geometry Major Update**。先检查是否已有同分支 PR，有则更新，避免重复创建；未创建时可使用 [GitHub 比较页面](https://github.com/qiu1112Nov/UNFORM/compare/main...feat/unform-4-sculpt-view?expand=1)。确认测试结果和上述摄像头待测风险后，由用户审核并决定合并。创建 PR 本身不部署；合并引起 main 更新才会触发正式 Pages 工作流，Cloudflare 仅用于预览。

## 项目结构

```text
src/main.js        页面状态、指针/触摸交互与键盘控制
src/particles.js   Canvas 渲染、形态过渡与性能预算
src/geometry.js    形态生成及手势到粒子控制的映射
src/octahedron.js  正八面体采样、共享表面网格与局部编织/断裂状态
src/motion.js      3.1 集中动态参数、可中断阻尼弹簧与结构保留规则
src/camera.js      权限、MediaPipe 懒加载及摄像头生命周期
src/gesture-pipeline.js 新帧调度、可信趋势、预响应/确认与分阶段计时
src/flow-state.js  FLOW/FRAGMENT/TRACE 集中参数、分层状态和三维轨迹环形缓冲
src/performance.js 手机预算、渐变粒子选择和带滞回的自适应质量
src/hand-worker-client.js 单帧在途的推理 Worker 通信与清理
public/hand-worker.js 真实 MediaPipe CPU 推理的独立 Worker
src/style.css      响应式黑白界面
scripts/           本地 WASM 资源准备
tests/             Node 内置测试，无需额外测试依赖
```

### FUSION 3.0 — Density Field

ORIGIN → FUSION opens a local image picker for JPEG, PNG and WebP (up to 20 MB; decoded images up to 40 megapixels). HEIC is not supported in this phase: export it as JPEG first. Choose an image, drag the square preview or use the position/zoom sliders, then select **CONFIRM IMAGE** to enter **TRANSLATE**. **EDIT FRAME** returns to the same crop; choosing another image resets framing. Cancel clears the local image and returns to ORIGIN. Dismissing the native picker leaves the current image unchanged.

Confirming a crop starts real local analysis and material generation in TRANSLATE; choose **ENTER CREATE / VIEW** when ready. **REGENERATE** varies particle sampling, and **EDIT FRAME** returns to the crop. Analysis errors explain how to retry. No automatic navigation or replacement of the GEOMETRY artwork occurs. Images are decoded in the page, never uploaded, and are not persisted across refreshes. The working source is reduced to a maximum side of 2048 pixels; the confirmed crop is 512×512. Very large originals can still use memory during the browser's initial image decode.

`src/fusion.js` separates preparation from translation: `FusionSession.getTranslationInput()` returns `null` until confirmation, then a versioned `{ version, kind, width, height, colorSpace, crop, pixels }` contract (`pixels` is RGBA `ImageData` in the browser). Crop coordinates use the resized, orientation-corrected working source. `src/image-translation.js` consumes that contract explicitly, with cancellation checks between bounded work batches. Adjustment/reselection invalidates the previous confirmation; cancellation also invalidates pending asynchronous image loads and releases the working canvas.


FUSION analyzes 64×64 luminance and opacity in the browser. `src/density-field.js` builds a multi-scale field from 1/3/7-pixel smoothing, background-relative contrast, alpha silhouette, medium-scale-supported contours, local gradient tensors/corners and the visual center. These are measured cues, not segmentation or object recognition. High-frequency texture has limited influence; when fine-scale variation lacks support at a coarser scale, a visible texture-dominated hint and a restrained neutral field replace false contours/glyphs/facets. Near-flat inputs receive the same restrained fallback. The TRANSLATE map now displays density, with node/link/facet statistics. Density weights and hard budgets live in `DENSITY_FIELD`; `TranslationJob.run({pixels}, {weights})` can override the named weights without changing defaults.

The octahedron is now an **implicit reference**, not a required external frame. `src/base-topology.js` retains the replaceable descriptor contract (six vertices, twelve edges, eight face regions, guide embedding and optional strict envelope). FUSION does not append reference vertices or edge samples to its particle pool, does not reserve those nodes at low quality and does not seed its display graph with preset edge chains. `createBaseScaffold` remains a helper for explicit future geometry modes, not a default FUSION generator. The renderer also excludes reference-tagged lines from submission, including charged weave lines; this is not an opacity adjustment. GEOMETRY's own octahedral renderer remains unchanged.

All visible FUSION nodes are sampled from the image density CDF, with contour-biased sampling, subcell jitter, negative space and about 20% interior detail samples. The base embedding now supplies 74% of XY placement and 86% of depth: diamond-tapered image coordinates and piecewise-linear triangular depth replace the former at-most-12% guide and rounded shallow relief. Image features still determine every sampled UV, local density, thickness variation and detail offset; this is neither a box normalization nor a uniform octahedron surface sample. Roughly 20% of eligible non-interior, contour-supported samples borrow a nearby reference-edge direction with a bounded pull (42%, at most .15 units), excluding edge endpoints. These disconnected ridge portions reuse image nodes, never seed full edge chains, and do not guarantee six equal tips for every subject. Detail offsets remain bounded to .065. The former hard L1 envelope is not applied to FUSION, and no fixed vertices dictate axis extents. A radius-1.55 numerical safety bound is not used as a sampling surface. Parameters live in `DENSITY_FIELD`; topology metadata lives in `mesh.referenceTopology`, while `mesh.nodes`, `mesh.links` and `mesh.triangles` describe only the visible image-driven sculpture.

One spatial graph owns particles, connections and facets. A 3D hash restricts local candidate searches to 48 per node; direction, distance, image-density support along each link, degree and deliberate isolated nodes prevent a uniform grid or bridges through negative space. Local links near supported ridge portions also favor the corresponding 3D diagonal, instead of following only the image's 2D tangent. Only closed local graph triangles with adequate shape, moderate density and coherent directions can become facets; their normals must align with a reference triangular face normal (absolute dot product at least .86). This constrains small existing graph triangles, never adds the eight reference faces. Total rest-triangle 3D area is at most 3.5% of the nodes' XY bounding-box area; this is a generation budget, not a guarantee of screen area at arbitrary VIEW angles. Live facets disappear during scattering or excessive strain. Corner-rich/contour-rich nodes may use sparse wireframe tetrahedron/octahedron micro-particles; their centers are graph nodes, with vertices projected in 3D. Graph links and facets use the exact live particle coordinates, so IMPRINT and movement cannot leave a second skeleton behind. FLOW follows existing graph edges with reusable buffers.

Maximum pools remain 850 mobile / 1900 desktop. Density graphs cap lines at 720 / 1600, facets at 14 / 28 and geometric glyphs at 24 / 48. The existing phone DPR, adaptive quality, trace budget and camera scheduling are unchanged. Adaptive particle subsets respect the image-driven category ratios; no reference nodes consume the visual budget; links/facets whose nodes are hidden are hidden too. Analysis, sampling and graph construction yield between bounded batches; a cancelled generation cannot publish a stale result. The existing renderer/VIEW/SCULPT loop is reused.

Depth perception follow-up: the triangular roof previously squeezed contour-heavy peripheral nodes toward the image plane. A bounded local thickness term now complements that roof according to the existing contour/thickness values and remaining roof depth, without resampling UVs, changing density weights or uniformly stretching Z. Supported local ridge links can cross more than the old .13 Z-gap cutoff; depth links receive limited priority within the same 48-candidate/degree/line budgets. Up to half the existing facet slots first seek valid triangles with a .065 depth span, then other valid triangles fill available slots. The original area budget and reference-face alignment still apply. FUSION facets use live-node normals with double-sided camera-space light (1.8–4% opacity); link base opacity has a restrained depth cue. Projection, camera inference, GEOMETRY and input/memory logic are unchanged. `tests/fixtures/fusion-volume-baseline.json` records density/sampling fingerprints and depth measurements from commit `2fb22ba`, so tests detect density drift as well as regressions in populated depth, slanted links and shared-node facets. Headless browser checks are not phone GPU or camera benchmarks.

GEOMETRY and the latest FUSION sculpture retain separate particle, memory/Undo, connectivity and observation states in the tab. ORIGIN provides **RESUME FUSION**. Replacing an existing FUSION with a newly generated material asks for confirmation. Undo removes imprints; Restore returns FUSION to its translated rest, not the original GEOMETRY shape. These states are not persisted through refresh. The image decoder can still briefly allocate the full original image before downsizing; phone memory usage, EXIF orientation and visual quality still require device testing.
