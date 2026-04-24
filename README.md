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

## AI Chat: llama3.2 and Grok setup

The `/ai` chat page supports two selectable models:

- `llama3.2`: local Ollama, called through `OLLAMA_URL` with the Ollama generate API.
- `grok`: local browser automation through the bundled `grok-scraper` folder. This is not an official API; it drives a Playwright browser session for `x.com/i/grok`.

### Environment variables

Add these values to `.env` as needed:

```env
OLLAMA_URL=http://localhost:11434
OLLAMA_MODEL=llama3.2
OLLAMA_TIMEOUT_MS=120000

OPENAI_BASE_URL=https://api.krouter.net/v1
OPENAI_MODEL=gpt-5.4
OPENAI_REASONING_EFFORT=high
OPENAI_TIMEOUT_MS=120000

AI_DEFAULT_MODEL=llama3.2
GROK_ENABLED=false
GROK_SCRAPER_PATH=./grok-scraper
GROK_TIMEOUT_MS=300000
```

For `gpt-5.4`, the web app uses the OpenAI-compatible `Responses API` endpoint at `${OPENAI_BASE_URL}/responses`, so a third-party gateway key can be saved in the `OpenAI-Compatible API Key` field on `/ai`.

Set `GROK_ENABLED=true` only on a local desktop or remote desktop with a real browser environment. Keep it `false` on headless servers or CI.

### Ollama llama3.2

1. Install and start Ollama.
2. Pull the model: `ollama pull llama3.2`.
3. Start this app with `npm run dev` or `npm start`.
4. Open `/ai`, choose `llama3.2`, and send a message.

### Grok scraper

1. Install scraper dependencies:

```bash
cd grok-scraper/scripts
npm install
npx playwright install chromium
```

2. Create a browser login session:

```bash
cd grok-scraper/scripts
npm run login
```

3. In the browser that opens, sign in to `x.com` with an account that can use Grok. Return to the terminal and press Enter to save the session.
4. Enable Grok for the app:

```env
GROK_ENABLED=true
GROK_SCRAPER_PATH=./grok-scraper
```

5. Restart the Node server, open `/ai`, choose `Grok`, and send a message.

The scraper writes results to `grok-scraper/output/latest.md`. If the x.com session expires, the app returns a clear login-required message; repeat `npm run login` from `grok-scraper/scripts`.

### Known Grok limitations

- Grok uses browser automation, so requests are slower than Ollama and are serialized by the server to protect the shared browser profile.
- It requires a real desktop browser session and will not work reliably in headless CI or a VPS without a GUI.
- x.com UI changes can break DOM scraping. Check `grok-scraper/output/run.log`, screenshots, and the scraper docs if Grok suddenly stops returning responses.
- This integration is for local use. Do not expose it as a public multi-user Grok API without considering account/session safety and x.com terms.
