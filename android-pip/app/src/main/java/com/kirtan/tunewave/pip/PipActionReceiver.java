package com.kirtan.tunewave.pip;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public final class PipActionReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null || intent.getAction() == null) return;
        MainActivity.dispatchPipAction(context, intent.getAction());
    }
}
