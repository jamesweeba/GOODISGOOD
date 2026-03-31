import {
  Controller,
  Get,
  Query,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Response } from 'express';
import { AdminService } from './admin.service';

@Controller('admin')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly configService: ConfigService,
  ) {}

  @Get()
  async dashboard(@Query('token') token?: string, @Res() res?: Response) {
    this.ensureAuthorized(token);
    const data = await this.adminService.getDashboardData();
    return res?.type('html').send(this.renderDashboard(data, token ?? ''));
  }

  private ensureAuthorized(token?: string) {
    const adminToken = this.configService.get<string>('admin.token');
    if (!adminToken) {
      return;
    }

    if (token !== adminToken) {
      throw new UnauthorizedException('Invalid admin token');
    }
  }

  private renderDashboard(
    data: Awaited<ReturnType<AdminService['getDashboardData']>>,
    token: string,
  ) {
    const escapeHtml = (value: unknown) =>
      String(value ?? '')
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');

    const card = (label: string, value: unknown, hint?: string) => `
      <div class="card">
        <div class="label">${escapeHtml(label)}</div>
        <div class="value">${escapeHtml(value)}</div>
        ${hint ? `<div class="hint">${escapeHtml(hint)}</div>` : ''}
      </div>
    `;

    const sessionRows = data.sessions
      .map(
        (session) => `
          <tr>
            <td>${escapeHtml(session.userPhone)}</td>
            <td>${escapeHtml(session.activeState ?? 'idle')}</td>
            <td>${escapeHtml(session.lastMessage ?? 'n/a')}</td>
            <td>${escapeHtml(session.updatedAt.toLocaleString())}</td>
          </tr>
        `,
      )
      .join('');

    const activeOrderRows = data.activeOrders
      .map((order) => {
        const items = order.items
          .map((item) => `${item.product.name} x ${item.quantity}`)
          .join(', ');

        return `
          <tr>
            <td>${escapeHtml(order.userPhone)}</td>
            <td><span class="pill">${escapeHtml(order.status)}</span></td>
            <td>$${escapeHtml(this.adminService.formatMoney(order.total))}</td>
            <td>${escapeHtml(items || 'No items')}</td>
            <td>${escapeHtml(order.updatedAt.toLocaleString())}</td>
          </tr>
        `;
      })
      .join('');

    const orderRows = data.recentOrders
      .map((order) => {
        const items = order.items
          .map((item) => `${item.product.name} x ${item.quantity}`)
          .join(', ');

        return `
          <tr>
            <td>${escapeHtml(order.userPhone)}</td>
            <td><span class="pill">${escapeHtml(order.status)}</span></td>
            <td>$${escapeHtml(this.adminService.formatMoney(order.total))}</td>
            <td>${escapeHtml(items || 'No items')}</td>
            <td>${escapeHtml(order.createdAt.toLocaleString())}</td>
          </tr>
        `;
      })
      .join('');

    const chatRows = data.recentChats
      .map(
        (chat) => `
          <tr>
            <td>${escapeHtml(chat.userPhone)}</td>
            <td><span class="pill ${chat.role === 'assistant' ? 'assistant' : 'user'}">${escapeHtml(chat.role)}</span></td>
            <td>${escapeHtml(chat.message)}</td>
            <td>${escapeHtml(chat.createdAt.toLocaleString())}</td>
          </tr>
        `,
      )
      .join('');

    return `
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>WhatsApp Sales Admin</title>
  <style>
    :root {
      --bg: #f5f1e8;
      --panel: #ffffff;
      --text: #1d1b16;
      --muted: #6d665b;
      --accent: #0f766e;
      --accent-soft: #d9f0ee;
      --border: #e6ddd0;
      --shadow: 0 12px 40px rgba(29, 27, 22, 0.08);
    }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: radial-gradient(circle at top left, #fff8ea, var(--bg) 55%);
      color: var(--text);
    }
    .wrap { max-width: 1280px; margin: 0 auto; padding: 32px 20px 48px; }
    .hero {
      background: linear-gradient(135deg, #173f3a, #0f766e);
      color: white;
      border-radius: 24px;
      padding: 28px;
      box-shadow: var(--shadow);
      margin-bottom: 24px;
    }
    .hero h1 { margin: 0 0 8px; font-size: 32px; }
    .hero p { margin: 0; color: rgba(255,255,255,0.82); max-width: 70ch; }
    .meta { margin-top: 14px; display: flex; flex-wrap: wrap; gap: 10px; }
    .meta span {
      background: rgba(255,255,255,0.12);
      color: white;
      border: 1px solid rgba(255,255,255,0.15);
      border-radius: 999px;
      padding: 8px 12px;
      font-size: 13px;
    }
    .grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; margin: 24px 0; }
    .card {
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      padding: 18px;
      box-shadow: var(--shadow);
    }
    .label { font-size: 12px; text-transform: uppercase; letter-spacing: .12em; color: var(--muted); }
    .value { font-size: 34px; font-weight: 800; margin-top: 8px; }
    .hint { color: var(--muted); margin-top: 4px; font-size: 13px; }
    .section { margin-top: 24px; }
    .section h2 { margin: 0 0 12px; font-size: 20px; }
    .table-wrap {
      overflow-x: auto;
      background: var(--panel);
      border: 1px solid var(--border);
      border-radius: 20px;
      box-shadow: var(--shadow);
    }
    table { width: 100%; border-collapse: collapse; min-width: 860px; }
    th, td { text-align: left; padding: 14px 16px; border-bottom: 1px solid var(--border); vertical-align: top; }
    th { font-size: 12px; text-transform: uppercase; letter-spacing: .08em; color: var(--muted); }
    tr:last-child td { border-bottom: none; }
    .pill {
      display: inline-flex;
      align-items: center;
      padding: 5px 10px;
      border-radius: 999px;
      background: var(--accent-soft);
      color: var(--accent);
      font-size: 12px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .06em;
    }
    .pill.user { background: #fff4d5; color: #9a6700; }
    .pill.assistant { background: #e1f5ee; color: #116b54; }
    .footer-note { color: var(--muted); font-size: 13px; margin-top: 18px; }
    @media (max-width: 1000px) {
      .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    }
    @media (max-width: 640px) {
      .grid { grid-template-columns: 1fr; }
      .hero h1 { font-size: 24px; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="hero">
      <h1>WhatsApp Sales Admin</h1>
      <p>Track products, live sessions, active carts, recent orders, and the latest conversations from one place.</p>
      <div class="meta">
        <span>Token ${token ? 'provided' : 'not required'}</span>
        <span>Sessions ${data.sessionCount}</span>
        <span>Recent chats ${data.recentChats.length}</span>
      </div>
    </div>

    <div class="grid">
      ${card('Products', data.productCount, 'Active catalog items')}
      ${card('Sessions', data.sessionCount, 'Persistent per-user state')}
      ${card('Active Orders', data.activeOrderCount, 'Pending or awaiting payment')}
      ${card('Recent Chats', data.recentChats.length, 'Latest inbound and outbound messages')}
    </div>

    <div class="section">
      <h2>Active Sessions</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>State</th>
              <th>Last Message</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${sessionRows || '<tr><td colspan="4">No sessions yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Active Carts</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Total</th>
              <th>Items</th>
              <th>Updated</th>
            </tr>
          </thead>
          <tbody>${activeOrderRows || '<tr><td colspan="5">No active carts</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Recent Orders</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Status</th>
              <th>Total</th>
              <th>Items</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>${orderRows || '<tr><td colspan="5">No orders yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="section">
      <h2>Recent Messages</h2>
      <div class="table-wrap">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Role</th>
              <th>Message</th>
              <th>Time</th>
            </tr>
          </thead>
          <tbody>${chatRows || '<tr><td colspan="4">No messages yet</td></tr>'}</tbody>
        </table>
      </div>
    </div>

    <div class="footer-note">
      If ADMIN_TOKEN is set, open the dashboard with <code>/admin?token=YOUR_TOKEN</code>.
    </div>
  </div>
</body>
</html>
    `.trim();
  }
}
