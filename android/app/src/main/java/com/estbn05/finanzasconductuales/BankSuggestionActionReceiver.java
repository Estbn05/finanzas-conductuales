package com.estbn05.finanzasconductuales;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.widget.Toast;

/**
 * The buttons on a "¿Lo registras?" notification, answered from the shade without opening
 * the app. The movements live in the app's own data, which only the app writes, so
 * "Registrar" marks the notice (quick) and the app records it the next time it reads its
 * notices: at launch, on coming back, or right away when it is already open. "No era
 * gasto" forgets the notice here and now.
 */
public class BankSuggestionActionReceiver extends BroadcastReceiver {
    static final String ACTION_RECORD = "com.estbn05.finanzasconductuales.BANK_RECORD";
    static final String ACTION_DISMISS = "com.estbn05.finanzasconductuales.BANK_DISMISS";
    static final String EXTRA_ID = "id";

    @Override
    public void onReceive(Context context, Intent intent) {
        String id = intent == null ? null : intent.getStringExtra(EXTRA_ID);
        if (id == null) {
            return;
        }
        if (ACTION_RECORD.equals(intent.getAction())) {
            BankNotificationListener.markQuick(context, id);
            Toast.makeText(context, "Listo. Queda registrado en cuanto abras la app.", Toast.LENGTH_SHORT).show();
        } else if (ACTION_DISMISS.equals(intent.getAction())) {
            BankNotificationListener.forget(context, id);
        } else {
            return;
        }
        BankSuggestionNotifier.cancel(context, id);
        BankNotificationsPlugin.pendingChanged();
    }
}
