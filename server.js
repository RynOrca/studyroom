const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 提升 Socket.io 的最大传输限制到 5MB，以支持图片和 GIF 的稳定发送
const io = new Server(server, {
    maxHttpBufferSize: 5 * 1024 * 1024 // 5MB
});

// 提供静态文件服务 (即你的 public 文件夹下的 index.html)
app.use(express.static('public'));

// 记录房间状态的全局对象 (内存数据库)
const roomData = {
    users: [],          // 当前在房间的用户 Socket ID 列表
    host: null,         // 当前主持人 ID
    chatEnabled: true,  // 聊天室全局禁言状态
    names: {},          // 存储：socket.id -> 自定义昵称
    timers: {}          // 存储：socket.id -> 专注状态字符串 (包含"干它!"任务状态)
};

io.on('connection', (socket) => {
    console.log('✅ 新成员连接，ID:', socket.id);

    // ================= 1. 房间与初始化状态 =================
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        roomData.users.push(socket.id);
        
        // 权限分配：第一个进入房间的人自动成为主持人
        if (roomData.users.length === 1) {
            roomData.host = socket.id;
        }

        // 初始化新用户的默认昵称和计时状态
        if (!roomData.names[socket.id]) {
            roomData.names[socket.id] = `成员(${socket.id.substring(0,4)})`;
        }
        roomData.timers[socket.id] = '暂无专注任务';

        // 向房间内所有人广播最新状态
        io.emit('room_update', roomData);
        
        // 专门通知房间内的其他老成员：有新成员加入，准备发起 WebRTC 连接
        socket.to(roomId).emit('user_joined', socket.id);
    });

    // ================= 2. 聊天室与文件发送 =================
    socket.on('chat_message', (msgData) => {
        // 权限校验：聊天室开启，或者发送者是主持人才允许广播
        if (roomData.chatEnabled || socket.id === roomData.host) {
            socket.broadcast.emit('chat_message', msgData);
        }
    });

    // ================= 3. 主持人权限管理 =================
    // 开关全局聊天室
    socket.on('toggle_chat', (enabled) => {
        if (socket.id === roomData.host) {
            roomData.chatEnabled = enabled;
            io.emit('room_update', roomData); 
        }
    });

    // 转移主持人权限
    socket.on('transfer_host', (targetId) => {
        if (socket.id === roomData.host && roomData.users.includes(targetId)) {
            roomData.host = targetId;
            io.emit('room_update', roomData);
        }
    });

    // ================= 4. 全局状态实时同步 =================
    // 同步用户自定义昵称
    socket.on('update_name', (newName) => {
        if (newName && newName.length >= 2 && newName.length <= 10) {
            roomData.names[socket.id] = newName;
            io.emit('room_update', roomData); 
        }
    });

    // 同步番茄钟及“干它！”任务状态
    socket.on('sync_timer', (statusStr) => {
        roomData.timers[socket.id] = statusStr;
        io.emit('room_update', roomData); 
    });

    // ================= 5. WebRTC 核心信令转发 =================
    // 无论是视频、麦克风还是系统音频的开启/关闭，都会触发 Offer/Answer 重协商
    socket.on('offer', (data) => socket.to(data.target).emit('offer', data));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', data));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', data));

    // ================= 6. 成员断开连接处理 =================
    socket.on('disconnect', () => {
        console.log('❌ 成员离开，ID:', socket.id);
        
        // 将用户从列表中移除
        roomData.users = roomData.users.filter(id => id !== socket.id);
        
        // 移交主持人权限逻辑
        if (socket.id === roomData.host) {
            roomData.host = roomData.users.length > 0 ? roomData.users[0] : null;
        }

        // 彻底清理该离开用户的内存数据
        delete roomData.names[socket.id];
        delete roomData.timers[socket.id];

        // 广播更新后的房间状态，并通知其他人销毁该用户的 WebRTC 视频组件
        io.emit('room_update', roomData); 
        socket.broadcast.emit('user_left', socket.id);
    });
});

// 启动服务器
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`🚀 云端自习室服务器已成功启动，正在监听端口 ${PORT}`);
});