# Mini LMS (Learning Management System)

Mini LMS là một nền tảng học tập trực tuyến đơn giản, dễ triển khai và mở rộng, được phát triển bằng Node.js, Express và MongoDB. Hệ thống cho phép người dùng đăng ký khóa học, theo dõi tiến độ học, ghi chú từng buổi học, đánh giá và khám phá nhiều chủ đề khác nhau.
![image](https://github.com/user-attachments/assets/ac4c4037-a8d2-46ce-a204-cf0151ede33e)

## Tính năng chính

-  Khám phá và đăng ký khóa học theo chủ đề
-  Xem video bài giảng từ Google Drive theo từng section
-  Đánh dấu đã học video (progress tracking)
-  Ghi chú cá nhân theo từng section
-  Đánh giá khóa học bằng sao và bình luận
-  Xác thực người dùng với Passport.js
-  Giao diện đơn giản, responsive, dễ sử dụng

##  Kiến trúc hệ thống

Hệ thống được xây dựng theo mô hình MVC:

- **Model**: Sử dụng Mongoose định nghĩa `User`, `Course`, `Section`, `Note`, `Review`, `Progress`
- **View**: Sử dụng EJS template + Bootstrap để render giao diện
- **Controller**: Điều phối logic giữa route, model và view

##  Công nghệ sử dụng

- **Backend**: Node.js, Express.js
- **Database**: MongoDB, Mongoose ODM
- **Authentication**: Passport.js (local strategy)
- **Validation**: Joi + express-validator
- **Security**: Helmet, Content Security Policy, mongo-sanitize
- **View Engine**: EJS
- **Google Drive API**: Quét thư mục khóa học từ Drive

##  Cài đặt & chạy dự án

### 1. Clone dự án
```bash
git clone https://github.com/your-username/mini-lms.git
cd mini-lms
```

### 2. Cài đặt các package
```bash
npm install
```

### 3. Tạo file `.env`
```env
DB_URL=mongodb://localhost:27017/lms
SESSION_SECRET=your-secret-key
```

### 4. Chạy ứng dụng
```bash
node server.js
```
Truy cập tại: [http://localhost:3000](http://localhost:3000)

##  Một số chức năng nổi bật

- Tự động quét Google Drive Folder khi tạo khóa học
- Ghi chú được lưu riêng theo từng section và user
- Tính toán tiến độ hoàn thành khóa học theo %
- Trang Explore hiển thị theo chủ đề, ẩn các khóa học đã đăng ký

##  Cấu trúc thư mục
```
├── models/             # Mongoose Models
├── routes/             # Express Routes
├── controllers/        # Controller Functions
├── views/              # EJS Templates
├── public/             # Static Assets (CSS, JS)
├── utils/              # Drive API utils, middleware
├── server.js           # Main entry point
└── .env                # Config file (not committed)
```

##  Giấy phép
Dự án mang tính học thuật và mở mã nguồn. Bạn có thể fork, cải tiến và sử dụng tự do với ghi nhận tác giả ban đầu.
