package com.estbn05.finanzasconductuales;

import android.appwidget.AppWidgetManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.SharedPreferences;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "WidgetBridge")
public class WidgetBridgePlugin extends Plugin {
    @PluginMethod
    public void update(PluginCall call) {
        String amount = call.getString("freeMoney", "$0");
        String period = call.getString("periodLabel", "");

        Context context = getContext();
        SharedPreferences prefs = context.getSharedPreferences(FreeMoneyWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE);
        prefs.edit()
            .putString(FreeMoneyWidgetProvider.KEY_AMOUNT, amount)
            .putString(FreeMoneyWidgetProvider.KEY_PERIOD, period)
            .apply();

        AppWidgetManager manager = AppWidgetManager.getInstance(context);
        ComponentName provider = new ComponentName(context, FreeMoneyWidgetProvider.class);
        int[] widgetIds = manager.getAppWidgetIds(provider);
        for (int widgetId : widgetIds) {
            FreeMoneyWidgetProvider.updateWidget(context, manager, widgetId);
        }

        call.resolve();
    }
}
