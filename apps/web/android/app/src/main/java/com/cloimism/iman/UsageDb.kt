package com.cloimism.iman

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper

data class LocalSession(val pkg: String, val start: Long, val end: Long?)

/** 기기 로컬 세션 원본. 시스템 사용 이벤트는 며칠만 보관되므로 이곳이 1차 원본이다 */
class UsageDb private constructor(ctx: Context) : SQLiteOpenHelper(ctx, "usage.db", null, 1) {
    override fun onCreate(db: SQLiteDatabase) {
        db.execSQL(
            """create table sessions (
                 pkg text not null, started integer not null, ended integer, synced integer not null default 0,
                 primary key (pkg, started))""",
        )
        db.execSQL("create index sessions_synced on sessions (synced)")
        db.execSQL("create index sessions_started on sessions (started)")
    }

    override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {}

    private fun read(sql: String, args: Array<String> = emptyArray()): List<LocalSession> =
        readableDatabase.rawQuery(sql, args).use { c ->
            buildList {
                while (c.moveToNext()) add(LocalSession(c.getString(0), c.getLong(1), if (c.isNull(2)) null else c.getLong(2)))
            }
        }

    fun open(): List<LocalSession> = read("select pkg, started, ended from sessions where ended is null")

    fun lastClosed(pkg: String): LocalSession? =
        read("select pkg, started, ended from sessions where pkg = ? and ended is not null order by ended desc limit 1", arrayOf(pkg)).firstOrNull()

    fun between(from: Long, to: Long): List<LocalSession> =
        read("select pkg, started, ended from sessions where started < ? and (ended is null or ended > ?)", arrayOf(to.toString(), from.toString()))

    /** 진행 중 세션은 종료될 때까지 매번 다시 보낸다 */
    fun unsynced(limit: Int): List<LocalSession> =
        read("select pkg, started, ended from sessions where synced = 0 order by started limit $limit")

    fun upsert(s: LocalSession) {
        val v = ContentValues().apply {
            put("pkg", s.pkg)
            put("started", s.start)
            if (s.end == null) putNull("ended") else put("ended", s.end)
            put("synced", 0)
        }
        writableDatabase.insertWithOnConflict("sessions", null, v, SQLiteDatabase.CONFLICT_REPLACE)
    }

    fun markSynced(list: List<LocalSession>) {
        val db = writableDatabase
        db.beginTransaction()
        try {
            for (s in list) {
                if (s.end == null) continue
                db.execSQL(
                    "update sessions set synced = 1 where pkg = ? and started = ? and ended = ?",
                    arrayOf<Any>(s.pkg, s.start, s.end),
                )
            }
            db.setTransactionSuccessful()
        } finally {
            db.endTransaction()
        }
    }

    fun prune(before: Long) {
        writableDatabase.execSQL("delete from sessions where synced = 1 and ended < ?", arrayOf<Any>(before))
    }

    companion object {
        @Volatile private var instance: UsageDb? = null
        fun get(ctx: Context): UsageDb = instance ?: synchronized(this) {
            instance ?: UsageDb(ctx.applicationContext).also { instance = it }
        }
    }
}
