<template>
  <!--
    App.vue - uni-app 入口组件

    uni-app 的 App.vue 不需要 router-view，
    页面由 pages.json 自动管理路由。
    这里只做全局样式和生命周期处理。
  -->
</template>

<script>
export default {
  onLaunch() {
    console.log('五子棋 App 启动')
  },
  onShow() {
    console.log('五子棋 App 显示')
  },
  onHide() {
    console.log('五子棋 App 隐藏')
  }
}
</script>

<style>
/* 全局样式 */
page {
  background-color: #f0ebe3;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  -webkit-font-smoothing: antialiased;
}

/* 重置按钮默认样式 */
button {
  padding: 0;
  margin: 0;
  line-height: 1.5;
}

button::after {
  border: none;
}
</style>