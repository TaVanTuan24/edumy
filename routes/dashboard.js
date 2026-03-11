const express = require("express");
const router = express.Router();
const db = require("../firebase");
const { isLoggedIn } = require('../middleware');
router.get("/", isLoggedIn, async (req, res) => {
    try {
        const snapshot = await db
            .collection("scan_logs")
            .orderBy("scannedAt", "desc")
            .get();

        const logs = snapshot.docs.map(doc => {
            const data = doc.data();
            return {
                id: doc.id,
                targetName: data.targetName,
                scannedAt: data.scannedAt
                    ? data.scannedAt.toDate().toLocaleString("vi-VN")
                    : "N/A"
            };
        });

        res.render("dashboard", { logs });

    } catch (err) {
        console.error("Firestore error:", err);
        res.send("Không đọc được dữ liệu Firestore");
    }
});
router.post("/delete/:id", isLoggedIn, async (req, res) => {
    try {
        await db.collection("scan_logs").doc(req.params.id).delete();
        res.redirect("/dashboard");
    } catch (err) {
        console.error(" Delete error:", err);
        res.send("Xóa thất bại");
    }
});
router.get("/edit/:id", isLoggedIn, async (req, res) => {
    const doc = await db.collection("scan_logs").doc(req.params.id).get();
    res.render("edit", { log: doc.data() });
});

// Lưu chỉnh sửa
router.post("/edit/:id", isLoggedIn, async (req, res) => {
    await db.collection("scan_logs").doc(req.params.id).update({
        targetName: req.body.targetName
    });
    res.redirect("/dashboard");
});
module.exports = router;
