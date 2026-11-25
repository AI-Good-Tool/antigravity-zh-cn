# Antigravity Windows 简体中文切换

## 适配版本

| 应用 | 实测版本（Windows 11 x64） | 中文覆盖 |
| --- | --- | --- |
| Antigravity App（桌面版） | **2.35.1** | 常用菜单、设置、按钮、模型列表、推理强度和模型提示 |
| Antigravity IDE（独立版） | **2.8.0** | Antigravity 设置、智能体面板和模型提示。编辑器菜单由微软简体中文语言包翻译 |

实测日期为 2026 年 11 月 25 日。可以在应用的「关于」里查看版本号。[Google 官方下载](https://antigravity.google/download)

## 使用方法

1. 从 Google 官网安装要使用的 Windows x64 版本。[Google 官方下载](https://antigravity.google/download)
2. **使用 IDE 时**，先在官方 IDE 按 `Ctrl+Shift+X` 打开扩展面板，搜索并安装 **Chinese (Simplified) Language Pack**（`MS-CEINTL.vscode-language-pack-zh-hans`）。IDE 2.8.0 已验证语言包 **1.106.0**。[Microsoft 简体中文语言包](https://marketplace.visualstudio.com/items?itemName=MS-CEINTL.vscode-language-pack-zh-hans)
3. 从 Release 的 **Assets** 下载 **`Antigravity-Windows-zh-CN.zip`**。右键 ZIP 并点「全部解压缩」。保留整个解压目录，再进入其中的 `windows` 文件夹。[Windows Release](https://github.com/AI-Good-Tool/antigravity-zh-cn/releases/tag/windows-v1.0.0)
4. 保存工作并完全退出目标应用。如果桌面版缩到了右下角的系统托盘，在托盘图标菜单里选择「退出」。
5. 双击下表中的脚本，等待应用打开。首次切换中文会生成副本，再次执行同一脚本可复用该副本。

   | 应用 | 打开简体中文 | 恢复英文 |
   | --- | --- | --- |
   | 桌面版 | `App 一键切换中文.cmd` | `App 一键恢复英文.cmd` |
   | 独立 IDE | `IDE 一键切换中文.cmd` | `IDE 一键恢复英文.cmd` |

中文副本位于 `%LOCALAPPDATA%\AntigravityLocalLanguage`。恢复英文脚本会用英文启动官方安装版。两种界面共用应用资料，每个应用一次打开一个版本。

## 更新应用

桌面版显示「用官方版更新」时，保存工作，点击按钮并确认「打开官方版」。IDE 可以通过 `IDE 一键恢复英文.cmd` 打开官方版。在官方版完成更新并退出后，使用适配新版本的脚本生成中文副本。如果应用内更新不可用，可以直接运行 Google 官网的新版安装程序。[Google 官方下载](https://antigravity.google/download)

如果切换脚本提示版本不匹配，可以先用英文脚本打开官方版。在 Windows 上，中文脚本会校验 Google 安装包内应用的文件指纹，确认是上表列出的版本。

## 自定义安装位置

如果安装到了自定义目录，可以在命令提示符里打开 `windows` 目录，再运行相应脚本。把示例最后的路径换成安装目录。

```cmd
"IDE 一键切换中文.cmd" "D:\Apps\Antigravity IDE"
```

词库和第三方许可在上一级目录。[第三方许可](../LICENSE-第三方词库与运行时.txt) · [设置截图](https://github.com/AI-Good-Tool/antigravity-zh-cn#界面截图)
