# 只属于我们的烟火

一个直接使用 Three.js 构建的实时 3D 烟花体验。镜头位于双人座位的眼睛高度，坐在月港王城的露台仰望夜空，包含程序化烟花、文字烟花、十二种预设图案、大画板、自定义烟花组、背景音乐与专业摄像模式。

## 运行

```bash
npm install
npm run dev
```

打开终端显示的本地地址即可。拖动可以上下左右转动视线，点击夜空会在当前视线方向发射烟花；右下角的烟花工坊可以输入文字、选择单束烟花、在 960×560 画板上作画，或编辑一组最多十二幕的烟花演出。

顶部“夜色”可以切换三种实时光影氛围；它们会同时改变天空、湖水、月光和城堡照明，不再切换到质量不一的独立地图。音乐面板内置一首 CC0 的肖邦《降 E 大调夜曲》，也支持从本地选择任意音频并调整音量。内置录音来源：[Wikimedia Commons](https://commons.wikimedia.org/wiki/File:Nocturne_Op._9_no._2_in_E_flat_major.mp3)。

按 `Command + P`（Windows 使用 `Ctrl + P`）进入专业摄像模式：当前时间会暂停，并可调整焦段、光圈、快门、ISO、对焦距离、镜头辉光和滤镜。`Space` 暂停或继续，`R` 重置眼睛视角，也可以把当前画面直接保存为 PNG。

## 技术

- Three.js 直接管理场景、镜头、粒子与角色
- 单一英雄场景使用模块化中世纪 PBR 建筑、2K 原始材质和 WebP GLB 交付
- 烟花颜色实时驱动城堡点光与湖面反射
- Unreal Bloom 后期辉光
- Canvas 采样生成文字与手绘粒子形状
- Blender 资产脚本生成城堡、观景台与高密度卡通陪伴角色
- 可排序烟花序列与逐幕配色、间隔设置
- Web Audio 实时合成升空和爆炸声
- vinext / React 页面外壳

建筑资产来源与许可见 [`public/models/THIRD_PARTY_ASSETS.md`](public/models/THIRD_PARTY_ASSETS.md)。
