const express = require('express');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);

// 【修改 1】：提升 Socket.io 的最大传输限制到 5MB，以支持图片和 GIF 发送
const io = new Server(server, {
    maxHttpBufferSize: 5 * 1024 * 1024 // 5MB
});

app.use(express.static('public'));

// 记录房间状态的全局对象
const roomData = {
    users: [],          // 当前在房间的用户ID列表
    host: null,         // 主持人ID
    chatEnabled: true,  // 聊天室是否开启
    names: {},          // 【修改 4】：存储 socket.id -> 昵称 的映射
    timers: {}          // 【修改 5】：存储 socket.id -> 专注状态字符串 的映射
};

io.on('connection', (socket) => {
    console.log('新成员连接，ID:', socket.id);

    // 1. 加入房间与初始化状态
    socket.on('join_room', (roomId) => {
        socket.join(roomId);
        roomData.users.push(socket.id);
        
        // 如果是第一个进来的人，任命为主持人
        if (roomData.users.length === 1) {
            roomData.host = socket.id;
        }

        // 初始化新用户的状态
        if (!roomData.names[socket.id]) {
            roomData.names[socket.id] = `成员(${socket.id.substring(0,4)})`;
        }
        roomData.timers[socket.id] = '暂无专注任务';

        // 广播最新的房间状态给所有人
        io.emit('room_update', roomData);
        // 通知其他人建立视频连接
        socket.to(roomId).emit('user_joined', socket.id);
    });

    // 2. 聊天室消息处理（带权限拦截与图片支持）
    socket.on('chat_message', (msgData) => {
        // 主持人或者聊天室开启时允许发送
        if (roomData.chatEnabled || socket.id === roomData.host) {
            // msgData 现在包含 isImage 字段
            socket.broadcast.emit('chat_message', msgData);
        }
    });

    // 3. 主持人权限操作：开关聊天室
    socket.on('toggle_chat', (enabled) => {
        if (socket.id === roomData.host) {
            roomData.chatEnabled = enabled;
            io.emit('room_update', roomData); // 通知所有人状态改变
        }
    });

    // 4. 主持人权限操作：转移主持人
    socket.on('transfer_host', (targetId) => {
        if (socket.id === roomData.host && roomData.users.includes(targetId)) {
            roomData.host = targetId;
            io.emit('room_update', roomData);
        }
    });

    // 【新增】：同步用户自定义昵称
    socket.on('update_name', (newName) => {
        if (newName && newName.length >= 2 && newName.length <= 10) {
            roomData.names[socket.id] = newName;
            io.emit('room_update', roomData); // 广播新名字
        }
    });

    // 【新增】：同步番茄钟专注状态
    socket.on('sync_timer', (statusStr) => {
        roomData.timers[socket.id] = statusStr;
        io.emit('room_update', roomData); // 广播新状态
    });

    // WebRTC 信令转发 (保持不变)
    socket.on('offer', (data) => socket.to(data.target).emit('offer', data));
    socket.on('answer', (data) => socket.to(data.target).emit('answer', data));
    socket.on('ice-candidate', (data) => socket.to(data.target).emit('ice-candidate', data));

    // 5. 成员离开处理
    socket.on('disconnect', () => {
        console.log('成员离开，ID:', socket.id);
        roomData.users = roomData.users.filter(id => id !== socket.id);
        
        // 如果主持人走了，自动移交给下一个人（如果有的话）
        if (socket.id === roomData.host) {
            roomData.host = roomData.users.length > 0 ? roomData.users[0] : null;
        }

        // 清理离开用户的昵称和专注状态数据
        delete roomData.names[socket.id];
        delete roomData.timers[socket.id];

        io.emit('room_update', roomData); // 更新在线人数、列表和可能的新主持人
        socket.broadcast.emit('user_left', socket.id);
    });
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`自习室服务器已启动: http://localhost:${PORT}`);
});