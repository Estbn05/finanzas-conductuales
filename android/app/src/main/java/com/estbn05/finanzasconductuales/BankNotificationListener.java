package com.estbn05.finanzasconductuales;

import android.app.Notification;
import android.content.Context;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.service.notification.NotificationListenerService;
import android.service.notification.StatusBarNotification;
import java.util.Arrays;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Keeps the text of notifications posted by the user's bank app so the app can offer
 * them as expenses to confirm ("¿Registrar este gasto?"). Everything stays on the phone:
 * notifications from any other app are ignored without being read, and nothing is kept
 * unless the user turned the feature on inside the app (KEY_ENABLED), on top of Android's
 * own notification-access permission.
 */
public class BankNotificationListener extends NotificationListenerService {
    static final String PREFS_NAME = "bank_notifications";
    static final String KEY_ENABLED = "enabled";
    static final String KEY_PENDING = "pending";
    static final Set<String> BANK_PACKAGES = new HashSet<>(Arrays.asList("com.nu.production"));
    // Unconfirmed notifications older than this many are dropped, oldest first.
    private static final int MAX_PENDING = 30;
    // Banks often re-post the same notification (an update, a group change) seconds later.
    private static final long DUPLICATE_WINDOW_MS = 2 * 60 * 1000;

    @Override
    public void onNotificationPosted(StatusBarNotification sbn) {
        keep(this, sbn);
    }

    // Notifications already in the shade when access is granted count too, so a purchase
    // made just before turning the feature on is not lost.
    @Override
    public void onListenerConnected() {
        try {
            StatusBarNotification[] active = getActiveNotifications();
            if (active == null) return;
            for (StatusBarNotification sbn : active) {
                keep(this, sbn);
            }
        } catch (RuntimeException ignored) {
            // The system can disconnect us between the callback and the call.
        }
    }

    static boolean isEnabled(Context context) {
        return prefs(context).getBoolean(KEY_ENABLED, false);
    }

    static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
    }

    private static void keep(Context context, StatusBarNotification sbn) {
        if (sbn == null || !BANK_PACKAGES.contains(sbn.getPackageName()) || !isEnabled(context)) {
            return;
        }
        Notification notification = sbn.getNotification();
        if (notification == null || (notification.flags & Notification.FLAG_GROUP_SUMMARY) != 0) {
            return;
        }
        Bundle extras = notification.extras;
        String title = text(extras, Notification.EXTRA_TITLE);
        String body = text(extras, Notification.EXTRA_BIG_TEXT);
        if (body.isEmpty()) {
            body = text(extras, Notification.EXTRA_TEXT);
        }
        if (title.isEmpty() && body.isEmpty()) {
            return;
        }
        store(context, sbn.getPackageName(), title, body, sbn.getPostTime());
    }

    private static String text(Bundle extras, String key) {
        if (extras == null) return "";
        CharSequence value = extras.getCharSequence(key);
        return value == null ? "" : value.toString().trim();
    }

    static synchronized JSONArray readPending(Context context) {
        try {
            return new JSONArray(prefs(context).getString(KEY_PENDING, "[]"));
        } catch (JSONException error) {
            return new JSONArray();
        }
    }

    static synchronized void writePending(Context context, JSONArray pending) {
        prefs(context).edit().putString(KEY_PENDING, pending.toString()).apply();
    }

    private static synchronized void store(Context context, String packageName, String title, String body, long postedAt) {
        JSONArray pending = readPending(context);
        for (int i = 0; i < pending.length(); i++) {
            JSONObject existing = pending.optJSONObject(i);
            if (existing != null
                && title.equals(existing.optString("title"))
                && body.equals(existing.optString("text"))
                && Math.abs(postedAt - existing.optLong("postedAt")) < DUPLICATE_WINDOW_MS) {
                return;
            }
        }
        try {
            JSONObject item = new JSONObject();
            item.put("id", packageName + ":" + postedAt + ":" + Integer.toHexString((title + "\n" + body).hashCode()));
            item.put("packageName", packageName);
            item.put("title", title);
            item.put("text", body);
            item.put("postedAt", postedAt);
            pending.put(item);
        } catch (JSONException error) {
            return;
        }
        JSONArray trimmed = new JSONArray();
        for (int i = Math.max(0, pending.length() - MAX_PENDING); i < pending.length(); i++) {
            trimmed.put(pending.opt(i));
        }
        writePending(context, trimmed);
    }
}
