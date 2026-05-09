/**
 * main.js - uni-app 入口文件
 *
 * uni-app 的 Vue 3 入口，不需要手动 createApp，
 * 框架会自动处理。
 */
import App from './App'

// #ifndef VUE3
import Vue from 'vue'
Vue.config.productionTip = false
App.mpType = 'app'
const app = new Vue(App)
app.$mount()
// #endif

// #ifdef VUE3
import { createSSRApp } from 'vue'
export function createApp() {
  const app = createSSRApp(App)
  return { app }
}
// #endif