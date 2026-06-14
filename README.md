# 📱 保号管理 (eSIM Manager)

一个部署在 **Cloudflare** 的保号到期提醒系统，支持 eSIM、服务器、手机号等周期性保号项目的管理。到期时通过 **Telegram** 和 **邮件** 双通道通知。

## ✨ 功能

- 🌐 网页端管理：添加 / 编辑 / 删除保号项目，设置周期与提醒提前天数
- 🔴 状态可视化：已逾期 / 即将到期 / 状态正常 三种状态
- ✓ 一键标记完成：自动计算下次到期日期，记录历史
- 🤖 Telegram 推送：每日定时检查并发送提醒
- 📧 邮件通知：基于 Resend 服务（每月 3000 封免费）
- 🔒 密码登录：单密码保护管理面板
- ☁️ 完全 Serverless：Cloudflare Workers + D1 + Pages

## 🚀 部署

### 1. 安装依赖
```bash
npm install
npx wrangler login
```

### 2. 创建 D1 数据库
```bash
npm run db:create
# 复制输出的 database_id 填入 wrangler.toml
npm run db:migrate:prod
```

### 3. 设置 Secrets
```bash
npx wrangler secret put ADMIN_SECRET        # 登录密码
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_CHAT_ID
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_TO
npx wrangler secret put EMAIL_FROM
```

### 4. 部署
```bash
npm run deploy
```

## 📂 项目结构

```
├── src/
│   ├── worker.js       # Worker 主入口 + API 路由
│   └── notify.js       # 通知逻辑（Telegram + Email）
├── public/             # 前端静态资源
│   ├── index.html
│   ├── style.css
│   └── app.js
├── migrations/         # D1 数据库迁移
├── wrangler.toml       # Cloudflare 配置
└── package.json
```

## 🛠️ 通知服务配置

- **Telegram Bot Token**：找 [@BotFather](https://t.me/BotFather) 创建机器人
- **Chat ID**：找 [@userinfobot](https://t.me/userinfobot) 获取
- **Resend API Key**：在 [resend.com](https://resend.com) 注册免费账号

## 📅 定时任务

每天北京时间 **09:00**（UTC 01:00）自动检查所有项目，对逾期或即将到期的项目发送通知。可在 `wrangler.toml` 中修改 cron 表达式。
