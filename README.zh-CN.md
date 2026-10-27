<p align="right"><a href="README.md">English</a> · <strong>简体中文</strong></p>

<p align="center">
  <img src="docs/assets/pwscc-mark.svg" alt="PWS CC 标识" width="88" height="88" />
</p>

<h1 align="center">PWS CC</h1>
<p align="center"><strong>你的成长，有迹可循</strong></p>
<p align="center">记录 · 复盘 · 成长</p>
<p align="center"><a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-1d5144?style=flat-square" alt="MIT License" /></a></p>

---

PWS CC 将对话、每日记录、复盘与趋势放在桌面 Web 控制台中。你可以直接编辑本地文件，或在 Web 与已绑定的微信中和助手对话；资料与记录保存在自己的工作区，简报和图表由已有内容生成。

## Quickstart

### 1. 克隆并启动

需要 Node.js 22.13+。

```powershell
git clone https://github.com/ravicc02/pws-cc.git
cd pws-cc/app
npm ci
npm run dev
```

打开 `http://127.0.0.1:4317/`。开发模式会同时启动 Web 和 API；端口若被占用，以终端输出为准。进入「模型配置」完成连接测试和保存后，即可在「对话」开始使用。微信绑定与提醒、复盘、简报时间都由你自行设置，默认不启用。

### 2. 交给 Agent 安装

也可以把下面这段发给有本机终端权限的 Agent：

```text
请帮我从零安装并启动 PWS CC：
1. 克隆 https://github.com/ravicc02/pws-cc.git；如果目标目录已经存在，先检查 Git 状态，不覆盖我的文件。
2. 阅读 README.md 与 AGENTS.md，确认 Node.js 22.13+；在 app/ 执行 npm ci 和 npm run dev，保持 Web 与 API 进程运行。
3. 实际检查 Web 首页和 /api/state 接口可访问，告诉我本地地址以及启动失败时的报错。
4. 引导我在 Web 测试并保存模型配置；微信扫码与定时发送由我决定。不要创建示例个人资料、补造每日记录、上传本地数据或替我开启消息发送。
```

## 你的成长，会被记录

在仪表盘查看每天的指标变化，并比较近期与过去的记录。

![PWS CC 仪表盘中的每日指标趋势](docs/assets/dashboard-metric-trends.png)

<sub>指标趋势 · 每日记录与过去均值</sub>

![PWS CC 仪表盘中的两个时段指标对比](docs/assets/dashboard-state-analysis.png)

<sub>状态趋势分析 · 同口径指标的时段对比</sub>

## 文件骨架

```text
pws-cc/
├── .gitignore
├── AGENTS.md
├── README.md
├── README.zh-CN.md
├── LICENSE
├── info.template.md               # 空白个人资料模板
├── info.md                         # 使用后按需生成，不随仓库提供
├── templates/                      # 空白模板，不视作用户数据
│   ├── info.md
│   ├── config/
│   │   ├── brief-template.md
│   │   └── daily-review-questions.json
│   ├── record/
│   │   ├── rute.md
│   │   └── daily.md
│   └── review/daily.md
├── record/
│   ├── .gitkeep
│   └── <category>/                 # 实际报告后才在本地创建
│       ├── rute.md                 # 分类规则
│       └── YYYY/MM/YYYY-MM-DD.md  # 按发生日期记录的事实
├── review/daily/
│   ├── .gitkeep
│   └── YYYY/MM/YYYY-MM-DD.md       # 回答复盘后在本地创建
├── config/                         # 可选的本地简报及复盘设置
│   └── .gitkeep
├── docs/                            # 设计依据与品牌资源
└── app/
    ├── src/                         # Web 控制台
    ├── server/                      # API、Agent、微信和调度
    ├── test/                        # 自动化测试
    └── runtime/                     # 本地配置、凭证与会话
```

- **`info.md`：**稳定的个人信息、偏好和明确提出的长期目标；首次提供后才创建。
- **`info.template.md`：**空白资料模板，不是用户资料。
- **`templates/`：**提供个人资料、分类规则、每日记录与复盘的空白模板；不会被读取为用户数据。
- **`templates/config/`：**可选的通用简报与复盘问题配置；需要时再复制到本地 `config/`。
- **`record/`：**按主题与日期保存实际发生的事。分类按用户报告的内容扩展，不预设一整套生活类别。
- **`rute.md`：**每个分类的记录范围、字段与确认规则；它是 Agent 的内部规则，不是某天的记录。
- **`review/daily/`：**存放用户对每日复盘问题的回答；每日简报只是已有事实的摘要，不写在这里。
- **`config/`：**可选的简报模板与复盘问题；没有自定义文件时使用内置默认值。
- **`AGENTS.md`：**工作区职责、初次使用、按需检索和增改记录的规范，供 Agent 阅读。
- **`app/src/`、`app/server/`、`app/test/`：**分别是控制台、服务端和测试代码；`docs/` 放设计依据与品牌资源。
- **`app/runtime/`：**模型凭证、微信状态、对话与分析缓存，仅保存在本机，不提交 Git。
- **`README.md`、`README.zh-CN.md`、`LICENSE`、`.gitignore`：**分别提供安装说明、MIT 授权文本与数据忽略规则。

新克隆的工作区没有 `info.md`、记录或复盘内容，只有空目录占位。个人资料、记录、复盘、配置及运行数据默认被 Git 忽略；请把自己的备份当作私密数据处理。

## 赞助商

<table>
  <tr>
    <td><a href="https://sshzyu.com"><img src="docs/assets/sshzyu-sponsor-zh.png" alt="SSHZYU · 模型聚合平台赞助" width="800" /></a></td>
  </tr>
</table>

## Star History

[![PWS CC Star 历史](https://api.star-history.com/svg?repos=ravicc02/pws-cc&type=Date)](https://www.star-history.com/#ravicc02/pws-cc&Date)

---

<p align="center"><a href="LICENSE">MIT License</a> · © 2026 ravicc02</p>
