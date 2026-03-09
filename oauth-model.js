const crypto = require('crypto');

// ========== 修改点 1：从环境变量加载配置，强制校验关键信息 ==========
// 从环境变量读取 OAuth 配置，生产环境通过 PM2/系统变量注入，开发环境从 .env 读取
const OAUTH_CLIENT_ID = process.env.OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI;

// 校验关键配置，缺失则终止进程，避免运行时出错
if (!OAUTH_CLIENT_ID || !OAUTH_CLIENT_SECRET || !OAUTH_REDIRECT_URI) {
  console.error('❌ OAuth 配置错误：请配置 OAUTH_CLIENT_ID、OAUTH_CLIENT_SECRET、OAUTH_REDIRECT_URI 环境变量');
  process.exit(1); // 终止进程，防止使用无效配置
}

// 客户端信息（从环境变量动态加载，不再硬编码）
const clients = [
  {
    id: OAUTH_CLIENT_ID, // 从环境变量读取
    clientId: OAUTH_CLIENT_ID,
    clientSecret: OAUTH_CLIENT_SECRET, // 敏感密钥从环境变量读取
    grants: ['authorization_code'],
    redirectUris: [OAUTH_REDIRECT_URI], // 回调地址从环境变量读取
  }
];

const tokens = new Map();       
const authorizationCodes = new Map(); 

// ========== 修改点 2：补充日志，便于排查授权问题 ==========
module.exports = {
  getClient: (clientId, clientSecret) => {
    console.log('[OAuth] 验证客户端信息，clientId:', clientId);
    const client = clients.find(c => c.clientId === clientId);
    if (!client) {
      console.error('[OAuth] 客户端不存在，clientId:', clientId);
      return false;
    }
    if (clientSecret && client.clientSecret !== clientSecret) {
      console.error('[OAuth] 客户端密钥错误，clientId:', clientId);
      return false;
    }
    return client;
  },
  saveAuthorizationCode: (code, client, user) => {
    console.log('[OAuth] 保存授权码，code:', code.authorizationCode.slice(0, 10) + '...'); // 脱敏日志
    const authorizationCode = {
      authorizationCode: code.authorizationCode,
      expiresAt: code.expiresAt,
      client,
      user,
      redirectUri: code.redirectUri,
    };
    authorizationCodes.set(code.authorizationCode, authorizationCode);
    return authorizationCode;
  },
  getAuthorizationCode: (authorizationCode) => {
    console.log('[OAuth] 获取授权码，code:', authorizationCode.slice(0, 10) + '...'); // 脱敏日志
    const code = authorizationCodes.get(authorizationCode);
    if (!code) {
      console.error('[OAuth] 授权码不存在，code:', authorizationCode.slice(0, 10) + '...');
    }
    return code;
  },
  revokeAuthorizationCode: (code) => {
    console.log('[OAuth] 撤销授权码，code:', code.authorizationCode.slice(0, 10) + '...');
    const isDeleted = authorizationCodes.delete(code.authorizationCode);
    if (!isDeleted) {
      console.warn('[OAuth] 撤销授权码失败，code不存在:', code.authorizationCode.slice(0, 10) + '...');
    }
    return isDeleted;
  },
  saveToken: (token, client, user) => {
    console.log('[OAuth] 保存访问令牌，accessToken:', token.accessToken.slice(0, 10) + '...');
    const accessToken = {
      accessToken: token.accessToken,
      accessTokenExpiresAt: token.accessTokenExpiresAt,
      client,
      user,
      scope: token.scope,
    };
    tokens.set(token.accessToken, accessToken);
    return accessToken;
  },
  getAccessToken: (accessToken) => {
    console.log('[OAuth] 验证访问令牌，accessToken:', accessToken.slice(0, 10) + '...');
    const token = tokens.get(accessToken);
    if (!token) {
      console.error('[OAuth] 访问令牌不存在，accessToken:', accessToken.slice(0, 10) + '...');
    }
    return token;
  },
  verifyScope: (token, scope) => {
    // 简化，不校验 scope；生产环境可根据需求扩展
    return true;
  },

};
