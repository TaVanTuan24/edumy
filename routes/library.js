const express = require('express');
const router = express.Router();
const ContentLibrary = require('../models/contentLibrary');
const Course = require('../models/course');
const { isLoggedIn } = require('../middleware');

router.post('/library/save-slide', isLoggedIn, async (req, res) => {
    try {
        const type = String(req.body.type || 'slide').trim() || 'slide';
        const name = String(req.body.name || 'AI Generated Slide').trim();
        const content = req.body.content && typeof req.body.content === 'object' ? req.body.content : {};
        const slides = Array.isArray(content.slides) ? content.slides : [];

        if (type !== 'slide') {
            return res.status(400).json({ success: false, error: 'Invalid type' });
        }

        const item = await ContentLibrary.create({
            userId: req.user._id,
            type: 'slide',
            title: name,
            data: { slides: slides },
            preview: slides.length ? slides.length + ' slides' : 'Slide deck'
        });

        res.json({ success: true, item: item });
    } catch (error) {
        console.error('Save slide to library error:', error);
        res.status(500).json({ success: false, error: 'Failed to save slide' });
    }
});

router.delete('/library/:id', isLoggedIn, async (req, res) => {
    try {
        const libraryId = String(req.params.id || '').trim();
        if (!libraryId) {
            return res.status(400).json({ success: false, error: 'Missing id' });
        }

        const item = await ContentLibrary.findOneAndDelete({
            _id: libraryId,
            userId: req.user._id
        });

        if (!item) {
            return res.status(404).json({ success: false, error: 'Item not found' });
        }

        await Course.updateMany(
            { author: req.user._id },
            {
                $pull: {
                    'sections.$[].lessons': { refId: libraryId }
                }
            }
        );

        res.json({ success: true });
    } catch (error) {
        console.error('Delete library item error:', error);
        res.status(500).json({ success: false, error: 'Failed to delete item' });
    }
});

module.exports = router;
