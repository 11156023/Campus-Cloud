import { createRouter, createWebHashHistory, RouteRecordRaw } from "vue-router";

const Layout = () => import("@/layout/index.vue");

const routes: RouteRecordRaw[] = [
  {
    path: "/login",
    name: "Login",
    meta: { title: "router.login.title", hidden: true },
    component: () => import("@/views/login/index.vue")
  },
  {
    path: "/",
    name: "Index",
    component: Layout,
    redirect: "/home",
    children: [
      {
        path: "/home",
        name: "Home",
        meta: {
          title: "router.home.title",
          icon: "rocket-launch-rounded",
          keepAlive: false
        },
        component: () => import("@/views/home/index.vue")
      },
      {
        path: "/config",
        name: "Config",
        meta: {
          title: "router.config.title",
          icon: "settings",
          keepAlive: false,
          hidden: true
        },
        component: () => import("@/views/config/index.vue")
      }
    ]
  }
];

const router = createRouter({
  history: createWebHashHistory(),
  routes
});

export default router;
