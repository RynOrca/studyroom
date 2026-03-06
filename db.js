const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// 数据库文件将自动保存在项目根目录的 study_room.db
const dbPath = path.resolve(__dirname, 'study_room.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('数据库连接失败:', err.message);
    } else {
        console.log('✅ 成功连接到 SQLite 数据库');
    }
});

// 初始化数据表
db.serialize(() => {
    // 1. 创建用户表
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        nickname TEXT NOT NULL,
        custom_audio TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // 尝试添加新列以兼容老数据库
    db.run(`ALTER TABLE users ADD COLUMN custom_audio TEXT`, (err) => {
        // 如果字段已经存在则会报错，由于只是为了兼容旧库，这里的报错直接忽略即可
    });
    
    // 2. 创建专注记录表 (新增)
    db.run(`CREATE TABLE IF NOT EXISTS focus_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        task_name TEXT,
        duration_mins INTEGER NOT NULL,
        record_date DATE DEFAULT CURRENT_DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);
    
    console.log('✅ 数据表检查/初始化完成 (包含 focus_records 和音频扩展)');
});

// 导出 db 供 server.js 使用
module.exports = db;