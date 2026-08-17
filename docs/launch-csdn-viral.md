# CSDN 爆款文案（可直接粘贴发布）

> 文案逻辑：钩子标题 → 场景化痛点 → 蹭热点（Hermes/OpenClaw/DSH）→ 核心卖点 → 真实成果背书 → 3 分钟上手 → 互动收尾。
> 所有"成果"均为真实数据，不吹不编。

---

## 标题（5 选 1，推荐 1 号）

1. **「DSH 界的 OpenClaw」上线首日就被官方收录：我把 DeepSeek Harness 变成了手机里随叫随到的 AI 管家，支持 7 个平台**
2. Hermes Agent 和 OpenClaw 都没做到的事：聊天里每一步思考都能回放，我把它做成了 DeepSeek Harness 插件
3. 拒绝黑盒 AI！DeepSeek Harness 多平台网关开源：WhatsApp/飞书/钉钉全接入，危险操作必须你点头
4. 一条命令部署，扫码即用：把 DeepSeek Harness 变成你微信里的私人 agent（附动画演示）
5. 实测：DeepSeek Harness 最值得装的开源插件，聊天全程可追踪，非程序员也能 3 分钟上手

---

## 正文（完整可直接粘贴）

### 开头钩子

你有没有经历过这种场景：

> 出门在外，手机上来了个需求——"帮我把这个项目的报价整理成表格"。你身边没有电脑，只有手机。
>
> 你打开手机里的聊天软件，给一个机器人发了句话。它开始思考，你甚至能看到它的每一步推理、每一次工具调用，像极了和同事并肩作战。任务完成前，它要做一步危险操作——删文件。它停下来，给你弹了个按钮：【✅ 同意】【🚫 拒绝】。
>
> 你点了一下同意，它继续干活，5 分钟后把结果发给你。

这不是科幻。这是我用 DeepSeek 官方开源的 [DeepSeek Harness](https://github.com/deepseek-ai/DeepSeek-Harness)（简称 DSH）做的一个东西——**dsh-overdrive**。

### 为什么是现在？

最近 AI 圈有两个名字很火：**Hermes Agent** 和 **OpenClaw**。它们把"终端里的 AI 代理"接进了微信、Telegram、Discord 等各种聊天软件，确实惊艳。

但它们有一个共性短板：**黑盒**。

你看到的是"它做完了"，看不到的是"它为什么这么做"。每一步思考、每个工具调用、每个可能出错的决定——全被折叠在一个 loading 里。

而 DeepSeek Harness 有一个别人抄不走的东西：**append-only 的会话日志**（session log）。每一步都记录在案。

我的想法很简单：**把这个"看得见的思考过程"搬进聊天软件里。** 于是有了 dsh-overdrive——**"DSH 界的 OpenClaw"**。

### 它解决了什么问题？

**① 聊天里全程可追踪（杀手锏）**

在聊天里发 `/trace`，agent 上一轮"想了什么、调了哪些工具、每一步耗时多少"全部回放成摘要卡片。它不是在表演思考，它是真的把账本摊开给你看。

**② 多智能体，聊天里指挥**

- `/task 写一句营销口号` → 派出子任务，独立干活，结果回传
- `/cron 0 9 * * * 每天早上给我一条技术新闻` → 定时任务，内置调度器，不依赖任何外部服务

**③ 危险操作，必须你点头**

agent 要执行高危操作（删文件、跑部署、动生产环境）时，会暂停并推送审批按钮。你在手机上看一眼，点【同意】它继续，点【拒绝】它停下。**AI 不能替你做主，永远你说了算。**

**④ 一条命令部署，扫码即用**

```bash
git clone https://github.com/temotee2103/dsh-overdrive && cd dsh-overdrive
cp deploy/.env.example .env
docker compose -f deploy/docker-compose.yml up -d --build
```

已有的 DSH 用户更简单，两行：

```bash
dsh plugin --profile web add @dsh-overdrive/gateway-core
npx dsh-overdrive-gateway
```

**支持平台：WhatsApp · Telegram · Discord · Slack · 飞书 · 钉钉 · 企业微信。**

**非程序员？也给你铺好了路**：一键安装脚本（`install.ps1` / `install.sh`）交互式问答，3 个问题装完；控制台自带四步引导向导，照着点就行。工具的设计理念是：**一个人装好，全家都能用**。

（效果长这样——README 里嵌了动画演示，动态展示消息、轨迹、审批全流程）

### 上线首日的成绩单

这个项目上线第一天，就已经被 DSH 生态"盖章"了：

- ✅ 被 **dsh-index**（DSH 插件索引站 dsh-index.xlings.org）收录，线上可直接检索
- ✅ 被 **awesome-deepseek-harness** 精选列表收录（中英文条目均已合并）
- ✅ 已在 **DeepSeek Harness 官方仓库 Discussion**（"Show Your Plugins!" 专区）发布
- ✅ npm 三包已发布：`@dsh-overdrive/sdk` / `gateway-core` / `gateway`，一行安装

> 注：最大列表 awesome-dsh-plugin 正在走收录流程（仓库年龄门禁中，约 10 小时后通过）。

### 技术架构（一句话看懂）

```
聊天软件 ←→ gateway（适配器很薄）←→ DSH 插件（轨迹/审批/多智能体的"灵魂"）
                      ↑ 协议：Remote Session Driver
```

核心思路：**"灵魂"在插件里，与聊天 SDK 完全解耦**——即使 DSH 插件 API 变动，gateway 适配层依然稳定。128+ 单元测试 + 全链路 E2E，CI 全绿。

### 仓库地址

⭐ https://github.com/temotee2103/dsh-overdrive （双语 README，点个 Star 就是最大的支持 🙏）

### 结尾互动（重要：引导评论）

说真的，**你最想让 AI 帮你做什么？** 是整理工作消息、定时看新闻，还是让它在微信里替你把报表跑完？

评论区聊聊你的场景——如果需求够多，我下一版就把对应的平台/命令安排上。顺手点个 **关注 + 收藏**，后续 v0.2（更多平台、Web 可视化设置）发布时第一时间看到。

---

## 发布策略（CSDN）

| 项 | 建议 |
|---|---|
| 分类/标签 | 分类：人工智能；标签：`DeepSeek` `DeepSeek Harness` `AI Agent` `开源` `插件` |
| 首图 | 用 README 动画演示（`docs/demo-animation.gif`）在关键帧（轨迹卡片+审批按钮同屏）截一张静态图，尺寸 16:9 |
| 发布时间 | 工作日 **10:00–11:00 或 20:00–22:00**（CSDN 流量高峰） |
| 前 30 分钟 | 发布后立即在开头钩子评论区自评一条："大家最想接入哪个平台？我看看投票" 引导互动 |
| 联动 | 同步发到掘金（改标题：`「DSH 界的 OpenClaw」…`）+ 知乎问题回答 |
| 注意事项 | CSDN 对硬广敏感：正文保留"开源项目分享"口吻，仓库链接放文末；不要出现"加微信/付费"等词 |
