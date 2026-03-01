const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('./db'); 

const app = express();
const server = http.createServer(app);

// 用于签发 JWT 的秘钥
const JWT_SECRET = 'super_secret_study_room_key_2026'; 

app.use(express.json());
app.use(express.static('public'));

// ================= HTTP API: 用户系统 =================
app.post('/api/register', async (req, res) => {
    const { username, password, nickname } = req.body;
    if (!username || !password || !nickname) {
        return res.status(400).json({ error: '请填写完整信息' });
    }
    // 严格的长度校验
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
                    if (err.message.includes('UNIQUE constraint failed')) {
                        return res.status(400).json({ error: '账号已存在' });
                    }
                    return res.status(500).json({ error: '数据库错误' });
                }
                res.json({ message: '注册成功！请登录' });
            }
        );
    } catch (error) {
        res.status(500).json({ error: '服务器错误' });
    }
});

app.post('/api/login', (req, res) => {
    const { username, password } = req.body;
    db.get(`SELECT * FROM users WHERE username = ?`, [username], async (err, user) => {
        if (err) return res.status(500).json({ error: '数据库错误' });
        if (!user) return res.status(401).json({ error: '账号或密码错误' });

        const isMatch = await bcrypt.compare(password, user.password);
        if (!isMatch) return res.status(401).json({ error: '账号或密码错误' });

        const token = jwt.sign({ id: user.id, username: user.username, nickname: user.nickname }, JWT_SECRET, { expiresIn: '7d' });
        res.json({ message: '登录成功', token, user: { id: user.id, username: user.username, nickname: user.nickname } });
    });
});

app.get('/api/verify', (req, res) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: '未提供 Token' });
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).json({ error: 'Token 无效或已过期' });
        res.json({ user: decoded });
    });
});


// ================= HTTP API: 专注记录系统 =================

// 中间件：用于验证 Token 并解析出 user_id (给需要登录的接口使用)
const authenticateToken = (req, res, next) => {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.sendStatus(401);
    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) return res.sendStatus(403);
        req.user = user;
        next();
    });
};

// 1. 保存一条专注记录
app.post('/api/records', authenticateToken, (req, res) => {
    const { task_name, duration_mins } = req.body;
    const user_id = req.user.id;

    db.run(`INSERT INTO focus_records (user_id, task_name, duration_mins) VALUES (?, ?, ?)`, 
        [user_id, task_name, duration_mins], 
        function(err) {
            if (err) return res.status(500).json({ error: '保存记录失败' });
            res.json({ message: '记录保存成功', id: this.lastID });
        }
    );
});

// 2. 获取当天的专注统计 (总时长和番茄钟次数)
app.get('/api/records/today', authenticateToken, (req, res) => {
    const user_id = req.user.id;
    // 使用 SQLite 的 date('now', 'localtime') 获取当天记录
    const query = `
        SELECT 
            COUNT(*) as pomodoros, 
            SUM(duration_mins) as total_mins,
            json_group_array(json_object('task', task_name, 'mins', duration_mins, 'time', time(created_at, 'localtime'))) as history
        FROM focus_records 
        WHERE user_id = ? AND record_date = date('now', 'localtime')
    `;

    db.get(query, [user_id], (err, row) => {
        if (err) return res.status(500).json({ error: '获取记录失败' });
        res.json({
            pomodoros: row.pomodoros || 0,
            totalMins: row.total_mins || 0,
            history: row.history ? JSON.parse(row.history) : []
        });
    });
});

// 3. 修改个人昵称接口
app.put('/api/user/nickname', authenticateToken, (req, res) => {
    const { nickname } = req.body;
    const user_id = req.user.id;
    
    if (!nickname || nickname.length < 2 || nickname.length > 15) {
        return res.status(400).json({ error: '专属昵称长度需在2到15字符之间' });
    }

    db.run(`UPDATE users SET nickname = ? WHERE id = ?`, [nickname, user_id], function(err) {
        if (err) return res.status(500).json({ error: '数据库更新失败' });
        res.json({ message: '昵称修改成功！', nickname });
    });
});

// 4. 获取专注月历数据接口 (按月聚合)
app.get('/api/records/calendar', authenticateToken, (req, res) => {
    const user_id = req.user.id;
    const month = req.query.month; // 预期格式 'YYYY-MM'
    if (!month) return res.status(400).json({ error: '缺少月份参数' });

    // SQLite 查询：按天分组，统计当天的总时长和任务列表
    const query = `
        SELECT 
            record_date,
            SUM(duration_mins) as daily_total_mins,
            COUNT(*) as daily_pomodoros,
            json_group_array(json_object('task', task_name, 'mins', duration_mins)) as tasks
        FROM focus_records 
        WHERE user_id = ? AND strftime('%Y-%m', record_date) = ?
        GROUP BY record_date
        ORDER BY record_date ASC
    `;

    db.all(query, [user_id, month], (err, rows) => {
        if (err) return res.status(500).json({ error: '获取日历数据失败' });
        
        // 将 SQLite 返回的 JSON 字符串转为真正的数组
        const formattedRows = rows.map(row => ({
            ...row,
            tasks: row.tasks ? JSON.parse(row.tasks) : []
        }));
        res.json(formattedRows);
    });
});

// 5. 获取最近的专注记录 (用于大厅时间轴展示)
app.get('/api/records/recent', authenticateToken, (req, res) => {
    const user_id = req.user.id;
    // 获取最近 50 条记录，按时间倒序
    const query = `
        SELECT task_name, duration_mins, record_date, time(created_at, 'localtime') as time_str
        FROM focus_records 
        WHERE user_id = ?
        ORDER BY created_at DESC
        LIMIT 50
    `;

    db.all(query, [user_id], (err, rows) => {
        if (err) return res.status(500).json({ error: '获取近期记录失败' });
        res.json(rows);
    });
});

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
const io = new Server(server, ioOptions);

// Socket 拦截器：校验连接的 Token
io.use((socket, next) => {
    const token = socket.handshake.auth.token;
    if (!token) {
        return next(new Error('未授权：请先登录'));
    }
    jwt.verify(token, JWT_SECRET, (err, decoded) => {
        if (err) return next(new Error('Token 无效或已过期'));
        socket.user = decoded; // 将数据库里真实的用户信息挂载到 socket 上
        next();
    });
});

// 核心：多房间状态管理器
const rooms = {};

io.on('connection', (socket) => {
    console.log(`✅ 新成员连接，ID: ${socket.id}, 昵称: ${socket.user.nickname}`);
    let currentRoom = null;

    // ================= 1. 房间与初始化状态 =================
    socket.on('join_room', (roomId) => {
        currentRoom = roomId;
        socket.join(roomId);
        
        // 如果房间不存在，则初始化房间数据结构
        if (!rooms[roomId]) {
            rooms[roomId] = {
                users: [],          
                host: null,         
                chatEnabled: true,  
                names: {},          
                timers: {}          
            };
        }
        
        const roomData = rooms[roomId];
        roomData.users.push(socket.id);

        if (roomData.users.length === 1) {
            roomData.host = socket.id;
        }

        // 直接使用数据库中的合法昵称，不再提供默认生成的昵称
        roomData.names[socket.id] = socket.user.nickname;
        roomData.timers[socket.id] = '暂无专注任务';

        // 只向当前房间内所有人广播最新状态
        io.to(roomId).emit('room_update', roomData);
        socket.to(roomId).emit('user_joined', socket.id);
    });

    // ================= 2. 聊天室与文件发送 =================
    socket.on('chat_message', (msgData) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        if (roomData.chatEnabled || socket.id === roomData.host) {
            socket.to(currentRoom).emit('chat_message', msgData);
        }
    });

    // ================= 3. 主持人权限管理 =================
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

    // ================= 4. 全局状态实时同步 =================
    // (注意：去掉了 update_name，因为要求名称只能在个人主页更改)

    socket.on('sync_timer', (statusStr) => {
        if (!currentRoom) return;
        const roomData = rooms[currentRoom];
        roomData.timers[socket.id] = statusStr;
        io.to(currentRoom).emit('room_update', roomData);
    });

    // ================= 5. WebRTC 核心信令转发 =================
    socket.on('offer', (data) => socket.to(data.target).emit('offer', data));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', data));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', data));

    // ================= 6. 成员断开连接处理 =================
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

        // 如果房间空了，为了防止内存泄漏，清理该房间
        if (roomData.users.length === 0) {
            delete rooms[currentRoom];
        } else {
            io.to(currentRoom).emit('room_update', roomData);
            socket.to(currentRoom).emit('user_left', socket.id);
        }
    });
});

// ================= 启动服务器（自动处理端口占用） =================
const DEFAULT_PORT = process.env.PORT || 3000;
let currentPort = DEFAULT_PORT;

function startServer(port) {
    server.listen(port, () => {
        console.log(`🚀 云端自习室服务器已成功启动，正在监听端口 ${port}`);
    }).on('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.log(`⚠️ 端口 ${port} 已被占用，尝试使用端口 ${port + 1}`);
            startServer(port + 1);
        } else {
            console.error('服务器启动失败:', err);
        }
    });
}

startServer(currentPort);

// ================= 全局异常捕获（防止进程意外退出） =================
process.on('uncaughtException', (err) => {
    console.error('未捕获的异常:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('未处理的 Promise 拒绝:', reason);
});