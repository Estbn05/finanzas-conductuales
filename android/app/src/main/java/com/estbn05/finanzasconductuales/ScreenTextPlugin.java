package com.estbn05.finanzasconductuales;

import android.app.Activity;
import android.content.ClipData;
import android.content.Intent;
import android.graphics.Rect;
import android.net.Uri;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.tasks.Tasks;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;
import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * "Leer capturas": the user picks screenshots of the bank's pockets (Nu's Cajitas) and
 * their text is read on the phone (ML Kit, bundled model: no internet, nothing leaves the
 * phone). Returns each line with its position; reconcile.js decides what is a pocket.
 */
@CapacitorPlugin(name = "ScreenText")
public class ScreenTextPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pickAndRead(PluginCall call) {
        Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
        pick.setType("image/*");
        pick.addCategory(Intent.CATEGORY_OPENABLE);
        pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
        startActivityForResult(call, pick, "picked");
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) {
            return;
        }
        List<Uri> uris = new ArrayList<>();
        Intent data = result.getData();
        if (result.getResultCode() == Activity.RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null) {
                for (int i = 0; i < clip.getItemCount(); i++) {
                    uris.add(clip.getItemAt(i).getUri());
                }
            } else if (data.getData() != null) {
                uris.add(data.getData());
            }
        }
        if (uris.isEmpty()) {
            JSObject none = new JSObject();
            none.put("images", new JSArray());
            call.resolve(none);
            return;
        }
        worker.execute(() -> read(call, uris));
    }

    private void read(PluginCall call, List<Uri> uris) {
        TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        try {
            JSArray images = new JSArray();
            for (Uri uri : uris) {
                InputImage image = InputImage.fromFilePath(getContext(), uri);
                Text text = Tasks.await(recognizer.process(image));
                JSArray lines = new JSArray();
                for (Text.TextBlock block : text.getTextBlocks()) {
                    for (Text.Line line : block.getLines()) {
                        Rect box = line.getBoundingBox();
                        JSObject item = new JSObject();
                        item.put("text", line.getText());
                        item.put("left", box == null ? 0 : box.left);
                        item.put("top", box == null ? 0 : box.top);
                        lines.put(item);
                    }
                }
                JSObject read = new JSObject();
                read.put("width", image.getWidth());
                read.put("lines", lines);
                images.put(read);
            }
            JSObject result = new JSObject();
            result.put("images", images);
            call.resolve(result);
        } catch (Exception error) {
            call.reject("No pude leer esas imágenes.", error);
        } finally {
            recognizer.close();
        }
    }
}
