# 开发说明

## 环境

- Node.js `22.13.0` 或更高版本
- npm
- 支持 WebGL 2 的现代桌面浏览器
- Blender（仅在重新构建 `hero-world.glb` 时需要）

## 常用命令

```bash
npm install
npm run dev
npm run lint
npm run build
```

| 命令 | 说明 |
|:--|:--|
| `npm run dev` | 启动本地 vinext/Vite 开发服务 |
| `npm run lint` | 检查 TypeScript、React 与可访问性规则 |
| `npm run build` | 生成本地生产构建 |
| `npm run start` | 启动已经生成的生产构建 |
| `npm run build:vercel` | 以 Vercel Nitro preset 构建部署产物 |

Vercel 使用仓库根目录的 `vercel.json`，其构建命令已经指向 `npm run build:vercel`。

## 代码结构

```text
app/
  globals.css                         应用视觉、控制台和曝光帘幕
  page.tsx                            页面入口
src/fireworks/
  FireworkExperience.tsx              产品状态、创作台、摄影 UI 与快捷键
  FireworkScene.ts                    Three.js 场景、后期、相机与曝光采集
  core/FireworkParticles.ts           火箭、爆炸粒子与图案生成
  audio/FireworkAudio.ts              录音分层、合成音和空间声场
  world/MagicCityWorld.ts             月港模型、灯光、水面与环境预设
  types.ts                            烟花、场景与摄影参数契约
public/models/hero-world.glb          浏览器实际加载的英雄场景
scripts/build_hero_assets.py          Blender 场景编排与 GLB 导出
```

烟花行为由 `LaunchOptions`、`FireworkTuning` 和 `FireworkShowCue` 等结构化参数驱动。创作台、自动播放和预设演出最终都调用同一个粒子与发射引擎，避免维护多份烟花规则。

## 重建英雄场景

`hero-world.glb` 由 Quaternius 的 Medieval Village MegaKit 模块和项目原创布局组合而成。构建脚本必须由 Blender 执行：

```bash
blender -b --python scripts/build_hero_assets.py -- \
  --kit "/path/to/Medieval Village MegaKit[Standard]/glTF" \
  --output public/models/hero-world.glb \
  --preview /tmp/hanabi-hero-preview.png
```

`--preview` 可省略。脚本会复用网格与材质、生成月港城堡和露台，使用 WebP 纹理并以 Draco level 7 导出 GLB。运行前请确认模型包路径正确；不要把原始第三方资产包提交进仓库。

## 摄影管线

渲染顺序为：场景渲染 → 景深 → Bloom → 调色与传感器噪声 → 输出。按下快门时，相机会锁定视角并在独立 Canvas 上积累曝光窗口内的帧；详细语义见 [摄影机制](./PHOTOGRAPHY.md)。

## 素材与发布

- 修改或替换模型、录音后，同步更新 [`public/models/THIRD_PARTY_ASSETS.md`](../public/models/THIRD_PARTY_ASSETS.md)。
- 烟花录音的原始来源见 [`public/audio/fireworks/README.md`](../public/audio/fireworks/README.md)。
- 项目尚未声明统一开源许可证，不应仅凭仓库公开就假定全部内容可自由再发布。
- 推送到默认分支后，已连接的 Vercel 项目可按其 Git 集成设置自动生成新部署；是否进入生产环境以 Vercel 项目配置为准。

## 维护状态

`v0.1.0` 之后项目进入暂缓更新状态。当前没有新增功能路线图；后续改动应优先保持体验稳定、文档准确和第三方素材归属清晰。
