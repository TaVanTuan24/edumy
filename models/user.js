const mongoose = require('mongoose');
const Schema = mongoose.Schema;
const passportLocalMongoose = require('passport-local-mongoose');

const UserSchema = new Schema({
    email: {
        type: String,
        required: true,
        unique: true,
        trim: true,
        lowercase: true
    },
    enrolledCourses: {
        type: [Schema.Types.Mixed],
        default: []
    },
    enrolledCourseIds: {
        type: [Schema.Types.ObjectId],
        ref: 'Course',
        default: []
    },
    gamification: {
        totalXP: {
            type: Number,
            default: 0
        },
        currentLevel: {
            type: Number,
            default: 1
        },
        currentStreak: {
            type: Number,
            default: 0
        },
        longestStreak: {
            type: Number,
            default: 0
        },
        lastActivityDate: {
            type: Date,
            default: null
        },
        earnedBadges: {
            type: [
                {
                    id: { type: String, default: '' },
                    name: { type: String, default: '' },
                    description: { type: String, default: '' },
                    icon: { type: String, default: '' },
                    earnedAt: { type: Date, default: Date.now }
                }
            ],
            default: []
        },
        stats: {
            lessonsCompleted: { type: Number, default: 0 },
            quizzesCompleted: { type: Number, default: 0 },
            highQuizScores: { type: Number, default: 0 },
            aiInteractions: { type: Number, default: 0 },
            coursesCompleted: { type: Number, default: 0 },
            completedLessonsCount: { type: Number, default: 0 }
        }
    }
})

UserSchema.methods.getEnrolledCourseIdSet = function() {
    const ids = (this.enrolledCourses || []).map((entry) => {
        if (!entry) return null;

        if (entry.courseId) {
            return String(entry.courseId);
        }

        // Backward compatibility in case some old documents still have raw ObjectId values.
        if (entry._bsontype === 'ObjectId' || typeof entry === 'string') {
            return String(entry);
        }

        return null;
    }).filter(Boolean);
    const directIds = (this.enrolledCourseIds || []).map((id) => id ? String(id) : null).filter(Boolean);

    return new Set(ids.concat(directIds));
};

UserSchema.methods.findEnrollment = function(courseId) {
    const target = String(courseId);

    if (Array.isArray(this.enrolledCourseIds)) {
        const match = this.enrolledCourseIds.find((entry) => String(entry) === target);
        if (match) return { courseId: match };
    }

    return (this.enrolledCourses || []).find((entry) => {
        if (!entry) return false;

        if (entry.courseId) return String(entry.courseId) === target;
        return String(entry) === target;
    });
};

UserSchema.pre('save', function(next) {
    if (!Array.isArray(this.enrolledCourses)) {
        this.enrolledCourses = [];
        return next();
    }

    this.enrolledCourses = this.enrolledCourses.map((entry) => {
        if (!entry) return entry;

        if (entry.courseId) return entry;

        if (entry._bsontype === 'ObjectId' || typeof entry === 'string') {
            return {
                courseId: entry,
                progress: {
                    completedCount: 0,
                    lastLessonId: ''
                },
                lastSeenUpdatedAt: null,
                enrolledAt: new Date()
            };
        }

        return entry;
    });

    next();
});

UserSchema.plugin(passportLocalMongoose);

module.exports = mongoose.model('User', UserSchema);
