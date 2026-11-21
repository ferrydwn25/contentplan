/**
 * VERCELBRIDGE.GS (STEP 3.5)
 * Menangani data OAuth Connections, Unified Inbox ("Balasan"), API Sync, dan Cron Auto-Publish.
 */

function getFullVercelBootstrapData() {
  try {
    const rawConns = DB_read(CONFIG.SHEETS.OAUTH_CONNECTIONS);
    const safeConns = rawConns.map(c => ({
      conn_id: c.conn_id,
      brand_name: c.brand_name,
      platform: c.platform,
      platform_user_id: c.platform_user_id,
      username: c.username,
      status: c.status,
      connected_at: c.connected_at
    }));

    return {
      success: true,
      brands: DB_read(CONFIG.SHEETS.BRAND_CONTEXT),
      slots: DB_read(CONFIG.SHEETS.SCHEDULE_SLOTS),
      contents: DB_read(CONFIG.SHEETS.CONTENTS),
      assets: DB_read(CONFIG.SHEETS.MEDIA_LIBRARY).reverse(),
      connections: safeConns,
      inbox: DB_read(CONFIG.SHEETS.UNIFIED_INBOX).reverse(),
      notifications: DB_read(CONFIG.SHEETS.NOTIFICATIONS).reverse()
    };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Mengembalikan token OAuth lengkap khusus untuk Server Vercel (/api/social-sync)
 * yang terautentikasi dengan VERCEL_API_SECRET.
 */
function getSecureOAuthTokensForServer() {
  try {
    const rawConns = DB_read(CONFIG.SHEETS.OAUTH_CONNECTIONS).filter(c => c.status === "Connected");
    return { success: true, connections: rawConns };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function saveOAuthConnection(payload) {
  try {
    const existing = DB_read(CONFIG.SHEETS.OAUTH_CONNECTIONS).find(
      c => c.brand_name === payload.brand_name && c.platform === payload.platform
    );

    const record = {
      brand_name: payload.brand_name,
      platform: payload.platform,
      platform_user_id: payload.platform_user_id || "",
      username: payload.username,
      access_token: payload.access_token,
      refresh_token: payload.refresh_token || "",
      expires_at: payload.expires_at || "",
      status: "Connected",
      connected_at: new Date().toISOString()
    };

    if (existing) {
      DB_update(CONFIG.SHEETS.OAUTH_CONNECTIONS, "conn_id", existing.conn_id, record);
    } else {
      record.conn_id = generateUUID();
      DB_insert(CONFIG.SHEETS.OAUTH_CONNECTIONS, record);
    }

    if (typeof logActivity === "function") {
      logActivity("OAuth", "Connect", `Connected ${payload.platform} (${payload.username}) to ${payload.brand_name}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function disconnectOAuthConnection(connId) {
  try {
    DB_delete(CONFIG.SHEETS.OAUTH_CONNECTIONS, "conn_id", connId);
    if (typeof logActivity === "function") {
      logActivity("OAuth", "Disconnect", `Disconnected OAuth ID ${connId}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function replyUnifiedInbox(msgId, replyText) {
  try {
    DB_update(CONFIG.SHEETS.UNIFIED_INBOX, "msg_id", msgId, {
      reply_text: replyText,
      status: "Replied",
      replied_at: new Date().toISOString()
    });
    if (typeof logActivity === "function") {
      logActivity("Inbox", "Reply", `Replied to comment ${msgId}`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

/**
 * Menyimpan komentar hasil tarik API ke UNIFIED_INBOX tanpa duplikasi
 */
function syncInboxBatchFromApi(commentsList) {
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const existing = DB_read(CONFIG.SHEETS.UNIFIED_INBOX);
    const existingIds = new Set(existing.map(x => String(x.msg_id)));
    let added = 0;

    commentsList.forEach(item => {
      const uniqueId = String(item.msg_id || generateUUID());
      if (!existingIds.has(uniqueId)) {
        DB_insert(CONFIG.SHEETS.UNIFIED_INBOX, {
          msg_id: uniqueId,
          brand_name: item.brand_name || "General",
          platform: item.platform || "YouTube",
          post_id: item.post_id || "",
          post_title: item.post_title || "Post",
          sender_username: item.sender_username || "@user",
          comment_text: item.comment_text || "",
          reply_text: "",
          status: "Unreplied",
          received_at: item.received_at || new Date().toISOString(),
          replied_at: ""
        });
        existingIds.add(uniqueId);
        added++;
      }
    });

    return { success: true, added: added };
  } catch (e) {
    return { success: false, error: e.message };
  } finally {
    lock.releaseLock();
  }
}

function ingestWebhookComment(payload) {
  try {
    DB_insert(CONFIG.SHEETS.UNIFIED_INBOX, {
      msg_id: payload.msg_id || generateUUID(),
      brand_name: payload.brand_name || "Bacon Files",
      platform: payload.platform,
      post_id: payload.post_id || "",
      post_title: payload.post_title || "Recent Post",
      sender_username: payload.sender_username,
      comment_text: payload.comment_text,
      reply_text: "",
      status: "Unreplied",
      received_at: new Date().toISOString(),
      replied_at: ""
    });
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function getDuePostsForCron(dateStr, hourPrefix) {
  try {
    const contents = DB_read(CONFIG.SHEETS.CONTENTS);
    const conns = DB_read(CONFIG.SHEETS.OAUTH_CONNECTIONS);

    const due = contents.filter(c => {
      const cDate = String(c.scheduled_date).split('T')[0];
      const cHour = String(c.scheduled_time || "19:00").substring(0, 2);
      return c.content_status === "Ready" && cDate === dateStr && cHour === hourPrefix;
    }).map(c => {
      const conn = conns.find(x => x.brand_name === c.brand_name && x.platform === c.platform && x.status === "Connected");
      return {
        ...c,
        oauth_token: conn ? conn.access_token : null,
        platform_user_id: conn ? conn.platform_user_id : null
      };
    });

    return { success: true, duePosts: due };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function markContentsPublishedByCron(publishedIds) {
  try {
    const now = new Date().toISOString();
    publishedIds.forEach(id => {
      DB_update(CONFIG.SHEETS.CONTENTS, "content_id", id, {
        content_status: "Published",
        published_date: now.split('T')[0],
        updated_at: now
      });
    });
    if (publishedIds.length > 0 && typeof logActivity === "function") {
      logActivity("Vercel Cron", "Auto-Publish", `Published ${publishedIds.length} scheduled posts.`);
    }
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function batchUpdateMetricsFromWorker_(dataArray) {
  try {
    const now = new Date().toISOString();
    dataArray.forEach(item => {
      DB_insert(CONFIG.SHEETS.CONTENT_METRICS, {
        metric_id: generateUUID(),
        content_id: item.content_id,
        views: item.views || 0,
        likes: item.likes || 0,
        comments: item.comments || 0,
        shares: item.shares || 0,
        saves: item.saves || 0,
        updated_at: now
      });
    });
    return { success: true, updated_rows: dataArray.length };
  } catch (e) {
    return { success: false, error: e.message };
  }
}

function installHourlyVercelTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  triggers.forEach(t => {
    if (t.getHandlerFunction() === "triggerVercelCronHourly") {
      ScriptApp.deleteTrigger(t);
    }
  });

  ScriptApp.newTrigger("triggerVercelCronHourly")
    .timeBased()
    .everyHours(1)
    .create();

  Logger.log("Berhasil memasang trigger gratis setiap 1 jam untuk Vercel Cron!");
}

function triggerVercelCronHourly() {
  const VERCEL_URL = PropertiesService.getScriptProperties().getProperty("VERCEL_APP_URL") 
                     || "https://contentplanz.vercel.app";

  try {
    const res = UrlFetchApp.fetch(`${VERCEL_URL}/api/cron-publish`, { muteHttpExceptions: true });
    Logger.log("Vercel Cron Response: " + res.getContentText());
  } catch (e) {
    Logger.log("Gagal ping Vercel Cron: " + e.toString());
  }
}
