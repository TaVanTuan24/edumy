const express = require('express');
const fs = require('fs');
const path = require('path');
const db = require('../firebase');
const { isLoggedIn, isAdmin } = require('../middleware');

const router = express.Router();
const dashboardEditViewPath = path.join(__dirname, '..', 'views', 'edit.ejs');

router.get('/', isLoggedIn, isAdmin, async (req, res) => {
    try {
        const snapshot = await db
            .collection('scan_logs')
            .orderBy('scannedAt', 'desc')
            .get();

        const logs = snapshot.docs.map((doc) => {
            const data = doc.data();
            return {
                id: doc.id,
                targetName: data.targetName,
                scannedAt: data.scannedAt
                    ? data.scannedAt.toDate().toLocaleString('vi-VN')
                    : 'N/A'
            };
        });

        res.render('dashboard', { logs });
    } catch (err) {
        console.error('Firestore error:', err);
        res.send('Khong doc duoc du lieu Firestore');
    }
});

router.post('/delete/:id', isLoggedIn, isAdmin, async (req, res) => {
    try {
        await db.collection('scan_logs').doc(req.params.id).delete();
        res.redirect('/dashboard');
    } catch (err) {
        console.error('Delete error:', err);
        res.send('Xoa that bai');
    }
});

router.get('/edit/:id', isLoggedIn, isAdmin, async (req, res) => {
    if (!fs.existsSync(dashboardEditViewPath)) {
        req.flash('error', 'Dashboard edit view is not available.');
        return res.redirect('/dashboard');
    }

    const doc = await db.collection('scan_logs').doc(req.params.id).get();
    res.render('edit', { log: doc.data() });
});

router.post('/edit/:id', isLoggedIn, isAdmin, async (req, res) => {
    await db.collection('scan_logs').doc(req.params.id).update({
        targetName: req.body.targetName
    });
    res.redirect('/dashboard');
});

module.exports = router;
