# UNFORM — Gesture-Driven Particle Art

黑白极简的交互粒子艺术实验。以 Canvas 2D 绘制可聚合、分解和重组的几何粒子场，适用于数字艺术与 UI/UX 作品集。

## 本地运行

需要 Node.js **20.19+ 或 22.12+**（推荐 Node 22/24）和 npm。

```sh
npm install
npm run dev
```

打开 Vite 输出的本地地址。后续复现安装用 `npm ci`。若云环境默认 npm 缓存目录不可写，可使用 `npm install --cache /tmp/unform-npm-cache`。安装会将固定版本的 MediaPipe WASM 文件复制到 `public/mediapipe/wasm/`（已忽略，不提交生成文件）。

```sh
npm test          # 几何分布、手势映射与边界测试
npm run build    # 生成 dist/，包含本地 WASM 资源
npm run preview  # 本地检查生产构建
```

## 交互

- **鼠标**：移动指针引导粒子场，按住并拖动使粒子扩散，释放后重组。
- **触摸**：单指拖动移动并扩散；双指距离控制分散程度，靠拢聚合、分开扩散。
- **形态**：Circle 为旋转球壳，Lines 为波形线列，Grid 为几何网格，切换时平滑重组。
- **Dispersion**：手动调整扩散；复位恢复圆形与 18% 扩散。
- **暂停**：暂停/继续动画。无控件焦点时，Space 切换暂停，1–3 切换形态。系统选择“减少动态效果”时默认暂停，需主动播放。
- **摄像头**：点击 Enable camera 后才请求权限。张掌扩散，握拳聚合，移动手部控制场的位置。有效手势优先于手动扩散设置；没有检测到手时自动恢复指针/触摸控制。

## 摄像头、隐私与兼容性

使用 `@mediapipe/tasks-vision` **0.10.32** 的 Hand Landmarker，单手推理上限约 12 次/秒，默认 CPU delegate 提高兼容性。第一次启用时下载官方固定版本手模型（约数 MB）：

`https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task`

WASM 与应用同源加载，模型需要连接 `storage.googleapis.com`。若使用 CSP，需要允许该域的 `connect-src`，并为 WASM 提供相应执行权限。加载速度受网络影响；无法下载、无摄像头或拒绝授权均保留指针与触摸交互。可关闭再重试。取消加载、关闭摄像头、切换后台及离开页面会释放摄像头；返回页面不会自动重新申请。

视频和识别均在浏览器内处理，不录制或上传视频，不请求麦克风权限。模型下载会向 Google 发起普通资源请求。

**手机摄像头必须使用 HTTPS**。桌面的 localhost 通常视为安全上下文，但通过手机访问局域网 HTTP IP 地址时，摄像头通常不可用。要测试手机手势，请使用下述 HTTPS 部署。推荐近期 Chrome、Safari、Edge；实际速度取决于设备、光照、手部遮挡和浏览器。WebView 或内嵌浏览器可能限制摄像头，请使用系统浏览器。

## 性能与无障碍

桌面最多 1,900 粒子、DPR 上限 2；窄屏或低核心设备最多 850 粒子、DPR 上限 1.5。后台暂停渲染并关闭摄像头。控件提供键盘操作、可见焦点和状态反馈；暂停状态也可静态切换形态。低性能手机可关闭摄像头，降低主线程推理开销。真实设备流畅度及真实手势识别仍需在目标手机上验收。

## GitHub Pages 部署（HTTPS）

仓库附有 `.github/workflows/pages.yml`。部署会公开网站；以下为操作步骤，**不表示已经部署**。

1. 将开发分支 PR 合并到 `main`。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. 在 **Actions → Deploy to GitHub Pages → Run workflow** 中选择 `main` 手动触发；之后推送到 main 会自动构建部署。
4. 等待 build 和 deploy 成功，从 Pages 设置或部署环境读取真实 HTTPS 地址。通常为 `https://qiu1112Nov.github.io/UNFORM/`，以 GitHub 实际显示为准。
5. 用手机与电脑打开地址，主动开启摄像头并验证张掌、握拳及拒绝授权回退。

Vite 使用 `base: './'`，资源支持 `/UNFORM/` 子路径。仓库/组织须允许 Pages 和 Actions；若权限受限可使用 Vercel。

## Vercel 部署（HTTPS）

1. 在 Vercel 选择 **Add New → Project**，导入本 GitHub 仓库。
2. 框架选 Vite，Root Directory 为仓库根目录；安装命令 `npm ci`，Build Command 为 `npm run build`，Output Directory 为 `dist`，Node.js 选 22 或 24。
3. Production Branch 选 `main` 并点击 Deploy。无需应用密钥或环境变量。
4. 成功后使用 Vercel 显示的真实 HTTPS 地址。开发分支也可生成独立 Preview Deployment。
5. 若有访问保护，需要在 Vercel 设置中允许目标访客访问，才能作为公开作品集网址。

## 分支与合并

开发分支：`feat/unform-particle-art`。若尚未自动创建 PR，可在 GitHub 打开 **Pull requests → New pull request**，base 选 `main`，compare 选该分支。检查构建和交互后合并。也可在已登录的 GitHub CLI 运行：

```sh
gh pr create --base main --head feat/unform-particle-art --title "Build UNFORM gesture-driven particle art" --body "Adds a responsive Vite/Canvas particle experience, optional local hand tracking, tests and HTTPS deployment instructions."
```

## 项目结构

```text
src/main.js        页面状态、指针/触摸交互与键盘控制
src/particles.js   Canvas 渲染、形态过渡与性能预算
src/geometry.js    形态生成及手势到粒子控制的映射
src/camera.js      权限、MediaPipe 懒加载及摄像头生命周期
src/style.css      响应式黑白界面
scripts/           本地 WASM 资源准备
tests/             Node 内置测试，无需额外测试依赖
```
