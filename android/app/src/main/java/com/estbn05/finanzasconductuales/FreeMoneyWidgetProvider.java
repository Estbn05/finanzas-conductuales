package com.estbn05.finanzasconductuales;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

public class FreeMoneyWidgetProvider extends AppWidgetProvider {
    static final String PREFS_NAME = "widget_data";
    static final String KEY_AMOUNT = "widget_free_money";
    static final String KEY_PERIOD = "widget_period_label";
    // Must match the intent-filter (scheme+host) declared in AndroidManifest.xml and
    // the QUICK_EXPENSE_HASH route app.js maps it to via @capacitor/app's appUrlOpen.
    static final String QUICK_ADD_URI = "finanzasconductuales://registrar-gasto";

    static void updateWidget(Context context, AppWidgetManager manager, int appWidgetId) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE);
        String amount = prefs.getString(KEY_AMOUNT, "$0");
        String period = prefs.getString(KEY_PERIOD, "");

        RemoteViews views = new RemoteViews(context.getPackageName(), R.layout.widget_free_money);
        views.setTextViewText(R.id.widget_amount, amount);
        views.setTextViewText(R.id.widget_period, period);

        // Tapping the amount/label area opens the app to whatever it last showed, same
        // as before this button existed.
        Intent launchIntent = new Intent(context, MainActivity.class);
        PendingIntent openIntent = PendingIntent.getActivity(
            context,
            0,
            launchIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_info, openIntent);

        // Tapping "+" jumps straight to "Registrar gasto". Needs its own distinct
        // request code (and a differing Intent via setData) — reusing the same
        // PendingIntent request code/intent as above would make Android collapse both
        // into a single PendingIntent, so only one of the two taps would ever fire.
        Intent quickAddIntent = new Intent(Intent.ACTION_VIEW, Uri.parse(QUICK_ADD_URI), context, MainActivity.class);
        PendingIntent quickAddPendingIntent = PendingIntent.getActivity(
            context,
            1,
            quickAddIntent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );
        views.setOnClickPendingIntent(R.id.widget_quick_add, quickAddPendingIntent);

        manager.updateAppWidget(appWidgetId, views);
    }

    @Override
    public void onUpdate(Context context, AppWidgetManager appWidgetManager, int[] appWidgetIds) {
        for (int appWidgetId : appWidgetIds) {
            updateWidget(context, appWidgetManager, appWidgetId);
        }
    }
}
