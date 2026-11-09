package com.knightsnavi.nback;

import android.graphics.Rect;
import android.util.DisplayMetrics;

import androidx.core.content.ContextCompat;
import androidx.core.util.Consumer;
import androidx.window.java.layout.WindowInfoTrackerCallbackAdapter;
import androidx.window.layout.DisplayFeature;
import androidx.window.layout.FoldingFeature;
import androidx.window.layout.WindowInfoTracker;
import androidx.window.layout.WindowLayoutInfo;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Reports the hinge of a foldable to the web layer using Jetpack WindowManager.
 *
 * Emits "foldchange" events and answers getState() with:
 *   { folding: bool, state: "flat" | "half", orientation: "horizontal" | "vertical",
 *     separating: bool, bounds: { left, top, right, bottom } }   // bounds in CSS px, relative to the web view
 */
@CapacitorPlugin(name = "Fold")
public class FoldPlugin extends Plugin {
    private WindowInfoTrackerCallbackAdapter tracker;
    private JSObject last = new JSObject().put("folding", false);
    private final Consumer<WindowLayoutInfo> consumer = this::onLayout;

    @Override
    public void load() {
        tracker = new WindowInfoTrackerCallbackAdapter(WindowInfoTracker.getOrCreate(getActivity()));
    }

    @Override
    protected void handleOnResume() {
        super.handleOnResume();
        if (tracker != null) {
            tracker.addWindowLayoutInfoListener(getActivity(), ContextCompat.getMainExecutor(getContext()), consumer);
        }
    }

    @Override
    protected void handleOnPause() {
        super.handleOnPause();
        if (tracker != null) tracker.removeWindowLayoutInfoListener(consumer);
    }

    @PluginMethod
    public void getState(PluginCall call) {
        call.resolve(last);
    }

    private void onLayout(WindowLayoutInfo info) {
        JSObject out = new JSObject().put("folding", false);
        for (DisplayFeature feature : info.getDisplayFeatures()) {
            if (!(feature instanceof FoldingFeature)) continue;
            FoldingFeature fold = (FoldingFeature) feature;
            DisplayMetrics metrics = getContext().getResources().getDisplayMetrics();
            float density = metrics.density;
            int[] webViewOrigin = new int[]{0, 0};
            if (getBridge() != null && getBridge().getWebView() != null) {
                getBridge().getWebView().getLocationInWindow(webViewOrigin);
            }
            Rect b = fold.getBounds();
            JSObject bounds = new JSObject()
                .put("left", (b.left - webViewOrigin[0]) / density)
                .put("top", (b.top - webViewOrigin[1]) / density)
                .put("right", (b.right - webViewOrigin[0]) / density)
                .put("bottom", (b.bottom - webViewOrigin[1]) / density);
            out = new JSObject()
                .put("folding", true)
                .put("state", fold.getState() == FoldingFeature.State.HALF_OPENED ? "half" : "flat")
                .put("orientation", fold.getOrientation() == FoldingFeature.Orientation.HORIZONTAL ? "horizontal" : "vertical")
                .put("separating", fold.isSeparating())
                .put("bounds", bounds);
            break;
        }
        last = out;
        notifyListeners("foldchange", out);
    }
}
