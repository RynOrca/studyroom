// ========== 修改点 1：优化 dotenv 加载逻辑 ==========
// 开发环境加载 .env 文件，生产环境依赖系统环境变量（不加载 .env）
if (process.env.NODE_ENV !== 'production') {
  require('dotenv').config({ path: '.env', debug: false }); // 仅开发环境加载
}

// ========== 修改点 2：强制校验核心环境变量 ==========
// JWT_SECRET 必须从环境变量获取，缺失则直接终止启动
const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET) {
  console.error('❌ 错误：未配置 JWT_SECRET 环境变量，请在 .env 或系统环境变量中设置');
  process.exit(1); // 终止进程，避免使用不安全的默认值
}

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); 

const app = express();
const server = http.createServer(app);

// ========== 修改点 3：补充跨域配置（解决前端跨域调用问题） ==========
// 生产环境替换为你的前端域名，比如 'https://your-study-room.com'
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.setHeader('Access-Control-Allow-Credentials', 'true'); // 允许携带 Cookie
  if (req.method === 'OPTIONS') return res.sendStatus(200);
  next();
});

app.use(express.json({ limit: '15mb' }));
app.use(express.static('public'));

const cookieParser = require('cookie-parser');
app.use(cookieParser());

// ================= HTTP API: 用户系统 =================
app.post('/api/register', async (req, res) => {
    const { username, password, nickname } = req.body;
    if (!username || !password || !nickname) {
        return res.status(400).json({ error: '请填写完整信息' });
    }
    if (password.length < 6) {
        return res.status(400).json({ error: '密码最低6位' });
    }
    if (nickname.length < 2 || nickname.length > 15) {
        return res.status(400).json({ error: '专属昵称长度需在2到15字符之间' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);
        db.run(`INSERT INTO users (username, password, nickname) VALUES (?, ?, ?)`, 
            [username, hashedPassword, nickname], 
            function(err) {
                if (err) {
                    // ========== 修改点 4：增加错误日志 ==========
                    console.error('注册失败:', err.message);
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: '账号已存在' });
                    }
                    return res.status(500).json({ error: '数据库错误' });
                }
                res.json({ message: '注册成功！请登录' });
            }
        );
    } catch (error) {
        console.error('注册服务器错误:', error);
        res.status(500).json({ error: '服务器错误' });
    }
});

app.post('/api/login', (req, res) => {
  const { username, password } = req.body;
  db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
    if (err) {
      console.error('登录查询失败:', err.message);
      return res.status(500).json({ error: '服务器错误' });
    }
    if (!user) return res.status(401).json({ error: '账号或密码错误' });

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) return res.status(401).json({ error: '账号或密码错误' });

    const token = jwt.sign({ id: user.id, username: user.username, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
    
    // ========== 修改点 5：生产环境自动启用 secure Cookie ==========
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7天
      sameSite: isProduction ? 'strict' : 'lax', // 生产环境更严格的跨站策略
      secure: isProduction, // 生产环境仅 HTTPS 传输 Cookie
      path: '/' // 确保所有路径都能访问 Cookie
    });

    res.json({ message: '登录成功', token, user: { id: user.id, username: user.username, nickname: user.nickname } });
  });
});

app.get('/api/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未提供 Token' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
          console.error('Token 验证失败:', err.message);
          return res.status(401).json({ error: 'Token 无效或已过期' });
        }
        res.json({ user: decoded });
    });
});

// ================= HTTP API: 专注记录与设置系统 =================
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
          console.error('接口鉴权失败:', err.message);
          return res.sendStatus(403);
        }
        req.user = user;
        next();
    });
};

// 以下接口逻辑不变，仅补充关键错误日志（示例）
app.post('/api/records', authenticateToken, (req, res) => {
    const { task_name, duration_mins } = req.body;
    const user_id = req.user.id;

    db.run(`INSERT INTO focus_records (user_id, task_name, duration_mins) VALUES (?, ?, ?)`, 
        [user_id, task_name, duration_mins], 
        function(err) {
            if (err) {
              console.error('保存专注记录失败:', err.message);
              return res.status(500).json({ error: '保存记录失败' });
            }
            res.json({ message: '记录保存成功', id: this.lastID });
        }
    );
});

// 【注】其余 API 接口逻辑完全不变，仅建议在所有数据库操作/错误处补充 console.error 日志
// （如 /api/records/today、/api/user/nickname 等接口，参考上面的错误日志写法即可）

// ================= Socket.io 配置与鉴权 =================
let ioOptions = {};
try {
    const semver = require('semver'); 
    const pkg = require('socket.io/package.json');
    if (semver.gte(pkg.version, '4.0.0')) {
        ioOptions.maxHttpBufferSize = 5 * 1024 * 1024; 
    }
} catch (e) {
    ioOptions.maxHttpBufferSize = 5 * 1024 * 1024;
}

// ========== 修改点 6：Socket.io 补充跨域配置 ==========
ioOptions.cors = {
  origin: ALLOWED_ORIGIN,
  credentials: true // 允许跨域携带 Cookie
};

const io = new Server(server, ioOptions);

io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('未授权：请先登录'));
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) {
          console.error('Socket 鉴权失败:', err.message);
          return next(new Error('Token 无效或已过期'));
        }
        socket.user = decoded;
        next();
    });
});

// Socket.io 核心逻辑完全不变，此处省略（与原代码一致）
const rooms = {};
io.on('connection', (socket) => {
    console.log(`✅ 新成员连接，ID: ${socket.id}, 昵称: ${socket.user.nickname}`);
    let currentRoom = null;

    socket.on('join_room', (roomId) => {
        currentRoom = roomId;
        socket.join(roomId);
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],          
                host: null,         
                chatEnabled: true,  
                names: {},          
                timers: {},
                dbIds: {} 
            };
        }
        const roomData = rooms[roomId];
        roomData.users.push(socket.id);
        if (roomData.users.length === 1) {
            roomData.host = socket.id;
        }
        roomData.names[socket.id] = socket.user.nickname;
        roomData.timers[socket.id] = '暂无专注任务';
        roomData.dbIds[socket.id] = socket.user.id; 
        io.to(roomId).emit('room_update', roomData);
        socket.to(roomId).emit('user_joined', socket.id);
    });

    socket.on('chat_message', (msgData) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        if (roomData.chatEnabled || socket.id === roomData.host) {
            socket.to(currentRoom).emit('chat_message', msgData);
        }
    });

    socket.on('toggle_chat', (enabled) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        if (socket.id === roomData.host) {
            roomData.chatEnabled = enabled;
            io.to(currentRoom).emit('room_update', roomData);
        }
    });

    socket.on('transfer_host', (targetId) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        if (socket.id === roomData.host && roomData.users.includes(targetId)) {
            roomData.host = targetId;
            io.to(currentRoom).emit('room_update', roomData);
        }
    });

    socket.on('sync_timer', (statusStr) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        roomData.timers[socket.id] = statusStr;
        io.to(currentRoom).emit('room_update', roomData);
    });

    socket.on('offer', (data) => socket.to(data.target).emit('offer', data));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', data));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', data));

    socket.on('disconnect', () => {
        console.log(`❌ 成员离开，ID: ${socket.id}, 昵称: ${socket.user.nickname}`);
        if (!currentRoom || !rooms[currentRoom]) return;
        const roomData = rooms[currentRoom];
        roomData.users = roomData.users.filter(id => id !== socket.id);
        if (socket.id === roomData.host) {
            roomData.host = roomData.users.length > 0 ? roomData.users[0] : null;
        }
        delete roomData.names[socket.id];
        delete roomData.timers[socket.id];
        delete roomData.dbIds[socket.id];
        if (roomData.users.length === 0) {
            delete rooms[currentRoom];
        } else {
            io.to(currentRoom).emit('room_update', roomData);
            socket.to(currentRoom).emit('user_left', socket.id);
        }
    });
});

// ================= 启动服务器 =================
// ========== 修改点 7：从环境变量读取端口 ==========
const PORT = process.env.PORT || 3000;

function startServer(port) {
    server.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn(`⚠️ 端口 ${port} 已被占用，尝试使用端口 ${port + 1}`);
            startServer(port + 1);
        } else {
            console.error('服务器发生未知错误:', err);
        }
    });

    server.listen(port, () => {
        console.log(`🚀 云端自习室服务器已成功启动（${process.env.NODE_ENV || '开发'}环境）`);
        console.log(`🔗 访问地址: http://localhost:${port}`);
    });
}

startServer(PORT);

// ================= 全局异常捕获 =================
process.on('uncaughtException', (err) => {
    console.error('🚨 未捕获的异常:', err);
    // 生产环境可考虑优雅退出，避免进程僵死
    if (process.env.NODE_ENV === 'production') process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('🚨 未处理的 Promise 拒绝:', reason);
});