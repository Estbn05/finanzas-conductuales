package com.estbn05.finanzasconductuales;

import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
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
        boolean enabled = BankNotificationListener.isEnabled(context);
        boolean permission = NotificationManagerCompat.getEnabledListenerPackages(context).contains(context.getPackageName());
        // The app asks for its status at launch and on every return to the foreground:
        // a good moment to reconnect a listener an app update left unbound.
        if (enabled && permission) {
            BankNotificationListener.requestRebind(context);
        }
        JSObject result = new JSObject();
        result.put("enabled", enabled);
        result.put("permission", permission);
        result.put("connected", BankNotificationListener.connected);
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

    /**
     * Where the user lets the app run in the background. Xiaomi's autostart screen when it
     * exists (the listener cannot be bound without it there), the app's info page otherwise.
     */
    @PluginMethod
    public void openBackgroundSettings(PluginCall call) {
        Context context = getContext();
        Intent autostart = new Intent();
        autostart.setComponent(new ComponentName("com.miui.securitycenter", "com.miui.permcenter.autostart.AutoStartManagementActivity"));
        autostart.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        try {
            context.startActivity(autostart);
        } catch (RuntimeException notXiaomi) {
            Intent details = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", context.getPackageName(), null));
            details.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            context.startActivity(details);
        }
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
