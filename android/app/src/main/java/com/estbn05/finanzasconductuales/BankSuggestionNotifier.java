package com.estbn05.finanzasconductuales;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import java.text.Normalizer;
import java.util.Locale;
import java.util.regex.Pattern;

/**
 * "¿Lo registras?": when the bank notifies a movement (a purchase, a transfer, money in,
 * a refund, a card payment), the app posts its own notification that opens the prefilled
 * form for it. Posted from the listener, so it works with the app closed. Only for a
 * notice that has an amount and reads like a movement; promos and codes stay quiet (they
 * still reach the app, which decides what each one is). Off with KEY_NOTIFY.
 */
final class BankSuggestionNotifier {
    static final String KEY_NOTIFY = "notify";
    private static final String CHANNEL_ID = "bank_suggestions";
    // A notice older than this when it reaches the listener (Android re-delivering the
    // shade after a reconnect) was seen long ago: no new "¿Lo registras?" for it.
    private static final long FRESH_MS = 15 * 60 * 1000;
    private static final Pattern AMOUNT = Pattern.compile("\\$\\s?\\d|\\d{1,3}(\\.\\d{3})+,\\d{2}");
    private static final Pattern MOVEMENT = Pattern.compile("compra|pag|envi|recib|retir|transfer|devoluci|reembols|revers|lleg|abon|consign");
    private static final Pattern NOT_A_MOVEMENT = Pattern.compile("codigo|clave|rechaz|declin|oferta|promo|cuota de manejo|no pudimos|fallid|faltan fondos|fondos insuficientes|saldo insuficiente|vuelve a intentar|intenta de nuevo|intentar de nuevo");

    private BankSuggestionNotifier() {}

    static boolean isOn(Context context) {
        return BankNotificationListener.prefs(context).getBoolean(KEY_NOTIFY, true);
    }

    static boolean looksLikeMovement(String title, String body) {
        String words = Normalizer.normalize(title + " " + body, Normalizer.Form.NFD)
            .replaceAll("\\p{M}", "")
            .toLowerCase(Locale.ROOT);
        return AMOUNT.matcher(words).find() && MOVEMENT.matcher(words).find() && !NOT_A_MOVEMENT.matcher(words).find();
    }

    static void maybePost(Context context, String id, String title, String body, long postedAt) {
        String skip = id == null ? "repeated"
            : !isOn(context) ? "turned off"
            : System.currentTimeMillis() - postedAt > FRESH_MS ? "old"
            : !looksLikeMovement(title, body) ? "not a movement"
            : null;
        NotificationManagerCompat manager = NotificationManagerCompat.from(context);
        if (skip == null && !manager.areNotificationsEnabled()) {
            skip = "notifications blocked";
        }
        // Why a notice got no "¿Lo registras?", without its text (logcat tag BankNotif).
        Log.i("BankNotif", "suggest " + (skip == null ? "posted" : "skipped: " + skip) + " at=" + postedAt);
        if (skip != null) {
            return;
        }
        ensureChannel(context);
        Intent open = new Intent(Intent.ACTION_VIEW, Uri.parse("finanzasconductuales://sugerencia?id=" + Uri.encode(id)), context, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent tap = PendingIntent.getActivity(context, notificationId(id), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        String what = title.isEmpty() ? body : title;
        NotificationCompat.Builder builder = new NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_finanzas)
            .setContentTitle("¿Lo registras?")
            .setContentText(what)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(title.isEmpty() || body.isEmpty() ? what : title + "\n" + body))
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setContentIntent(tap)
            .setAutoCancel(true);
        try {
            manager.notify(notificationId(id), builder.build());
        } catch (SecurityException notAllowed) {
            // POST_NOTIFICATIONS was taken back: the movement still waits on Inicio.
            Log.i("BankNotif", "suggest refused by Android");
        }
    }

    /** The suggestion was recorded or dismissed in the app: its "¿Lo registras?" goes too. */
    static void cancel(Context context, String id) {
        NotificationManagerCompat.from(context).cancel(notificationId(id));
    }

    private static int notificationId(String id) {
        return 0x4E550000 ^ id.hashCode();
    }

    private static void ensureChannel(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return;
        }
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) {
            return;
        }
        NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Movimientos para registrar", NotificationManager.IMPORTANCE_DEFAULT);
        channel.setDescription("Cuando Nu te avisa de un movimiento, te proponemos registrarlo.");
        manager.createNotificationChannel(channel);
    }
}
