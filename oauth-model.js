const crypto = require('crypto');

const clients = [
  {
    id: 'memos-client',
    clientId: 'memos-client',
    clientSecret: '6666yyds', 
    grants: ['authorization_code'],
    redirectUris: ['http://120.25.175.134:5230/auth/callback'], 
  }
];

const tokens = new Map();       
const authorizationCodes = new Map(); 

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
    return true; 
  },

};
