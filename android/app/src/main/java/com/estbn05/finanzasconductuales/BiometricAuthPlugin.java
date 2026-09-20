package com.estbn05.finanzasconductuales;

import androidx.annotation.NonNull;
import androidx.biometric.BiometricManager;
import androidx.biometric.BiometricPrompt;
import androidx.core.content.ContextCompat;
import androidx.fragment.app.FragmentActivity;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.concurrent.Executor;

@CapacitorPlugin(name = "BiometricAuth")
public class BiometricAuthPlugin extends Plugin {
    private static final int ALLOWED =
        BiometricManager.Authenticators.BIOMETRIC_STRONG | BiometricManager.Authenticators.BIOMETRIC_WEAK;

    @PluginMethod
    public void isAvailable(PluginCall call) {
        BiometricManager manager = BiometricManager.from(getContext());
        int status = manager.canAuthenticate(ALLOWED);
        JSObject result = new JSObject();
        result.put("available", status == BiometricManager.BIOMETRIC_SUCCESS);
        call.resolve(result);
    }

    @PluginMethod
    public void authenticate(final PluginCall call) {
        final String reason = call.getString("reason", "Confirma tu identidad");
        final FragmentActivity activity = (FragmentActivity) getActivity();
        if (activity == null) {
            call.reject("no-activity");
            return;
        }
        activity.runOnUiThread(new Runnable() {
            @Override
            public void run() {
                Executor executor = ContextCompat.getMainExecutor(activity);
                BiometricPrompt prompt = new BiometricPrompt(activity, executor, new BiometricPrompt.AuthenticationCallback() {
                    @Override
                    public void onAuthenticationSucceeded(@NonNull BiometricPrompt.AuthenticationResult authResult) {
                        call.resolve();
                    }

                    @Override
                    public void onAuthenticationError(int errorCode, @NonNull CharSequence errString) {
                        call.reject(errString.toString(), String.valueOf(errorCode));
                    }
                });
                BiometricPrompt.PromptInfo info = new BiometricPrompt.PromptInfo.Builder()
                    .setTitle("Desbloquear Finanzas")
                    .setSubtitle(reason)
                    .setNegativeButtonText("Usar PIN")
                    .setAllowedAuthenticators(ALLOWED)
                    .setConfirmationRequired(false)
                    .build();
                prompt.authenticate(info);
            }
        });
    }
}
