package com.estbn05.finanzasconductuales;

import android.content.Context;
import android.content.Intent;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashSet;
import java.util.Set;
import org.json.JSONArray;
import org.json.JSONObject;

/** The app's side of BankNotificationListener: turn it on/off and collect what it kept. */
@CapacitorPlugin(name = "BankNotifications")
public class BankNotificationsPlugin extends Plugin {
    /** enabled: turned on in the app. permission: Android's notification access granted. */
    @PluginMethod
    public void status(PluginCall call) {
        Context context = getContext();
        JSObject result = new JSObject();
        result.put("enabled", BankNotificationListener.isEnabled(context));
        result.put("permission", NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName()));
        call.resolve(result);
    }

    /** Turning it off also forgets every notification not yet confirmed. */
    @PluginMethod
    public void setEnabled(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        Context context = getContext();
        BankNotificationListener.prefs(context).edit().putBoolean(BankNotificationListener.KEY_ENABLED, enabled).apply();
        if (!enabled) {
            BankNotificationListener.writePending(context, new JSONArray());
        }
        call.resolve();
    }

    /** Android's own screen to grant (or take back) notification access. */
    @PluginMethod
    public void openSettings(PluginCall call) {
        Intent intent = new Intent(Settings.ACTION_NOTIFICATION_LISTENER_SETTINGS);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
        call.resolve();
    }

    @PluginMethod
    public void getPending(PluginCall call) {
        JSArray notifications = new JSArray();
        JSONArray pending = BankNotificationListener.readPending(getContext());
        for (int i = 0; i < pending.length(); i++) {
            notifications.put(pending.opt(i));
        }
        JSObject result = new JSObject();
        result.put("notifications", notifications);
        call.resolve(result);
    }

    /** Confirmed or dismissed in the app: never offered again. */
    @PluginMethod
    public void dismiss(PluginCall call) {
        Set<String> ids = new HashSet<>();
        JSArray requested = call.getArray("ids", new JSArray());
        for (int i = 0; i < requested.length(); i++) {
            ids.add(requested.optString(i));
        }
        Context context = getContext();
        JSONArray pending = BankNotificationListener.readPending(context);
        JSONArray kept = new JSONArray();
        for (int i = 0; i < pending.length(); i++) {
            JSONObject item = pending.optJSONObject(i);
            if (item != null && !ids.contains(item.optString("id"))) {
                kept.put(item);
            }
        }
        BankNotificationListener.writePending(context, kept);
        call.resolve();
    }
}
