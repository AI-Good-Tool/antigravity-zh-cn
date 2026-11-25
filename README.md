# Antigravity 简体中文切换

在 macOS 上一键打开 Google Antigravity 桌面版或 Antigravity IDE 的简体中文界面，也可以一键切回英文。脚本从 Google 官方应用生成单独的中文副本，切回英文时打开官方原版。

## 适配版本

截至 **2026 年 11 月 25 日**，适配 Google 官网提供的以下最新版。[Google Antigravity 下载页](https://antigravity.google/download)

| 应用 | 适配版本 | 中文覆盖 |
| --- | --- | --- |
| Antigravity App（桌面版） | **2.35.1**，兼容 **2.34.0** | 常用菜单、设置、操作按钮、模型列表、推理强度、模型标签和提示 |
| Antigravity IDE（独立版） | **2.8.0** | Antigravity 设置、智能体面板、模型列表和提示、部分内置技能描述。编辑器菜单和通用设置由简体中文语言包提供 |

实测环境为 Apple Silicon Mac，macOS 26.7。翻译覆盖常用界面。遇到新版新增的文案，部分控件可能仍显示英文。

## 界面截图

### Antigravity App 2.35.1

模型选择器显示中文推理强度、模型状态和用量入口。

![Antigravity App 2.35.1 中文模型选择器](docs/screenshots/antigravity-app-models.png)

### Antigravity IDE 2.8.0

智能体面板里的模型选择器显示中文状态和推理强度。将鼠标移到模型旁的 ⓘ，可以查看该模型的中文提示。

![Antigravity IDE 2.8.0 中文模型选择器](docs/screenshots/antigravity-ide-models.png)

## 使用前准备

1. 从 Google 官网安装桌面版或独立 IDE。把相应的 `Antigravity.app` 或 `Antigravity IDE.app` 放在「应用程序」目录（`/Applications` 或 `~/Applications`）。[官方下载](https://antigravity.google/download)
2. 在本仓库选择 **Code → Download ZIP**，解压后保留整个文件夹。启动脚本会从同一个文件夹读取词库和翻译代码。
3. 确认终端可以执行 `/usr/bin/python3 --version`。如果 macOS 提示安装命令行开发者工具，可以运行 `xcode-select --install`，安装完成后再运行脚本。
4. **使用 IDE 时**，先在官方 IDE 按 `⇧⌘X` 打开扩展面板，搜索并安装 `MS-CEINTL.vscode-language-pack-zh-hans`。也可以下载 `.vsix`，通过命令面板的 **Extensions: Install from VSIX…** 安装。语言包会翻译编辑器自身的菜单和设置。[Microsoft 简体中文语言包](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)

## 切换中文和恢复英文

1. 保存工作，在要切换的应用里按 `⌘Q` 完全退出。
2. 在访达打开解压后的文件夹，按下表双击对应脚本。

   | 应用 | 切换到简体中文 | 恢复英文 |
   | --- | --- | --- |
   | 桌面版 | `一键切换中文.command` | `一键恢复英文.command` |
   | 独立 IDE | `IDE 一键切换中文.command` | `IDE 一键恢复英文.command` |

3. 等终端显示启动结果。第一次切换中文需要复制应用和签名，后续启动会复用已生成的同版本副本。

如果访达没有执行脚本，可以在终端进入解压目录，再运行下方对应的命令。

```sh
/bin/zsh "./一键切换中文.command"
/bin/zsh "./一键恢复英文.command"
/bin/zsh "./IDE 一键切换中文.command"
/bin/zsh "./IDE 一键恢复英文.command"
```

中文版和英文版使用同一套本地应用资料，请一次打开同一应用的一个版本。中文副本保存在 `~/Library/Application Support/Antigravity 语言切换/` 或 `~/Library/Application Support/Antigravity IDE 语言切换/`。

## 更新应用

### 桌面版

1. 如果仍看到旧按钮「重启以更新」，先保存并退出，再双击本仓库的 `一键切换中文.command` 生成新版脚本对应的中文副本。
2. 新副本检查到更新时会显示 **用官方版更新**。保存工作后，点击按钮并确认 **打开官方版**。脚本会核验原版签名，正常退出中文副本，并打开 Google 官方原版。
3. 在官方原版完成更新。如果原版没有自动开始检查，在 macOS 菜单栏选择 **Antigravity → Check for Updates…**，然后按原版提示重启。
4. 等更新完成并退出原版，再双击 `一键切换中文.command`。脚本会根据新版本生成中文副本。

中文副本由本机签名。Google 更新包由 Google 签名，macOS 会在官方原版中核验和安装更新。

### 独立 IDE

1. 保存后退出 IDE，双击 `IDE 一键恢复英文.command` 打开官方原版。
2. 通过官方原版完成更新，或从官网下载新版本放入「应用程序」。[官方下载](https://antigravity.google/download)
3. 更新完成后退出原版，双击 `IDE 一键切换中文.command`。

## 常见问题

- **提示找不到应用**。检查「应用程序」中的文件名和所在目录，确认选了桌面版或独立 IDE 对应的脚本。
- **提示原版签名有问题**。从 Google 官网重新安装对应版本，再执行切换脚本。[官方下载](https://antigravity.google/download)
- **IDE 智能体面板是中文，编辑器菜单仍是英文**。在官方 IDE 安装 Microsoft 简体中文语言包，退出后重新运行对应的中文脚本。
- **升级后提示界面加载方式变化**。用恢复脚本打开英文原版，待脚本适配该版本后再生成中文副本。

## 第三方许可

词库和运行时基于 Antigravity Chinese Localization 社区项目，保留上游的 MIT 许可及版权声明。[上游项目](https://github.com/antigravity-cn-community/Antigravity-Chinese-Localization) · [第三方许可](LICENSE-第三方词库与运行时.txt)
