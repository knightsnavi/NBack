package com.knightsnavi.nback;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(FoldPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
