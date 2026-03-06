// oauth-model.js
const crypto = require('crypto');

// 客户端信息（Memos）
const clients = [
  {
    id: 'memos-client',
    clientId: 'memos-client',
    clientSecret: '6666yyds', // 替换为你自己的密钥
    grants: ['authorization_code'],
    redirectUris: ['http://120.25.175.134:5230/auth/callback'], // Memos 回调地址
  }
];

const tokens = new Map();       // accessToken -> 令牌对象
const authorizationCodes = new Map(); // code -> 授权码对象

module.exports = {
  getClient: (clientId, clientSecret) => {
    const client = clients.find(c => c.clientId === clientId);
    if (!client) return false;
    if (clientSecret && client.clientSecret !== clientSecret) return false;
    return client;
  },
  saveAuthorizationCode: (code, client, user) => {
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
    return authorizationCodes.get(authorizationCode);
  },
  revokeAuthorizationCode: (code) => {
    return authorizationCodes.delete(code.authorizationCode);
  },
  saveToken: (token, client, user) => {
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
    return tokens.get(accessToken);
  },
  verifyScope: (token, scope) => {
    return true; // 简化，不校验 scope
  },
};