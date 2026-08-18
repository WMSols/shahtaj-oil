/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { registry } from "@web/core/registry";
import { hasFinancialAccess } from "../shahtaj_access";
import { StaffManagement } from "./staff_management";
import { OperationsTracking } from "./operations_tracking";
import { TerritoryRoutes } from "./territory_routes";
import { WarehouseInventory } from "./warehouse_inventory";
import { FinancialsInvoicing } from "./financials_invoicing";
import { PortalSettings } from "./settings"
import { SchedulesTargets } from "./schedules_targets";
import { BankTransactions } from "./bank_transactions";
import { ConfirmModal } from "./confirm_modal";

export class ShahtajDashboard extends Component {
    static components = { StaffManagement, OperationsTracking, TerritoryRoutes, WarehouseInventory, FinancialsInvoicing, PortalSettings, SchedulesTargets, BankTransactions, ConfirmModal }; 

    setup() {
        this.orm = useService("orm");
        const today = new Date();
        const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
        const formatDate = (d) => {
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
        };
        this.todayStr = formatDate(today);
        this.tomorrowStr = formatDate(tomorrow);

        this.state = useState({
            activeTab: 'overview', // Default to the new Master Overview
            activeSubTab: '', 
            isSidebarOpen: false, 
            isSwitchingTab: false,
            isLoadingKpis: false,
            // Master KPI State
            kpis: {
                totalZones: 0,
                totalRoutes: 0,
                totalShops: 0,
                pendingShops: 0,
                totalBookers: 0,
                onlineBookers: 0,
                todayCheckins: 0,
                todayOrders: 0,
                pendingDeliveries: 0,
                totalProducts: 0,
                outOfStockProducts: 0,
                activeSchedules: 0,
                activeTargets: 0,
                totalOrders: 0,
                toInvoice: 0,
                openInvoices: 0,
                creditNotes: 0,
                approvedShops: 0,
            },
            // Tracks which accordion menus are currently expanded
            expandedMenus: {
                territory: true, // Open by default
                warehouse: false,
                operations: false,
                financials: false,
                schedules: false
            }
        });
        // Global Event listnere to sync child component tab switches with the main dashboard state
        window.addEventListener('shahtaj-dashboard-switch', (ev) => {
            this.switchTab(ev.detail.tab, ev.detail.subTab);
        });
        onWillStart(async () => {
            await this.fetchMasterKPIs();
        });
        
    }
    
    async fetchMasterKPIs() {
        this.state.isLoadingKpis = true;
        const todayStart = `${this.todayStr} 00:00:00`;
        const tomorrowStart = `${this.tomorrowStr} 00:00:00`;
        const productBaseDomain = [
            ["sale_ok", "=", true],
            ["default_code", "!=", "SHAHTAJ-LEGACY"],
            ["active", "=", true],
        ];

        try {
            const coreCountsPromise = Promise.all([
                this.orm.searchCount("shahtaj.zone", [["active", "=", true]]),
                this.orm.searchCount("shahtaj.route", [["active", "=", true]]),
                this.orm.searchCount("res.partner", [["is_shahtaj_shop", "=", true], ["active", "=", true]]),
                this.orm.searchCount("res.partner", [["is_shahtaj_shop", "=", true], ["active", "=", true], ["shop_approval_state", "=", "pending"]]),
                this.orm.searchCount("res.users", [["shahtaj_is_order_booker", "=", true], ["active", "=", true]]),
                this.orm.searchCount("res.users", [["shahtaj_is_order_booker", "=", true], ["active", "=", true], ["shahtaj_online_status", "=", "online"]]),
                this.orm.searchCount("shahtaj.visit", [["started_at", ">=", todayStart], ["started_at", "<", tomorrowStart]]),
                this.orm.searchCount("sale.order", [["shahtaj_visit_id", "!=", false], ["date_order", ">=", todayStart], ["date_order", "<", tomorrowStart]]),
                this.orm.searchCount("sale.order", [["shahtaj_visit_id", "!=", false], ["state", "=", "sale"]]),
                this.orm.searchCount("product.template", productBaseDomain),
                this.orm.searchCount("product.template", [...productBaseDomain, ["qty_available", "<=", 0]]),
                this.orm.searchCount("shahtaj.weekly.schedule", [["active", "=", true]]),
                this.orm.searchCount("shahtaj.visit.target", [["active", "=", true]]),
            ]);

            const financialCountsPromise = this.hasFinancialAccess
                ? Promise.all([
                    this.orm.searchCount("sale.order", [["shahtaj_visit_id", "!=", false]]),
                    this.orm.searchCount("sale.order", [["shahtaj_visit_id", "!=", false], ["invoice_status", "=", "to invoice"]]),
                    this.orm.searchCount("account.move", [["move_type", "in", ["out_invoice"]], ["partner_id.is_shahtaj_shop", "=", true], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]]),
                    this.orm.searchCount("account.move", [["move_type", "=", "out_refund"], ["partner_id.is_shahtaj_shop", "=", true]]),
                    this.orm.searchCount("res.partner", [["is_shahtaj_shop", "=", true], ["shop_approval_state", "=", "approved"]]),
                ])
                : Promise.resolve([0, 0, 0, 0, 0]);

            const [coreCounts, financialCounts] = await Promise.all([coreCountsPromise, financialCountsPromise]);

            const [
                zones, routes, shops, pendingShops,
                totalBookers, onlineBookers,
                todayCheckins, todayOrders, pendingDeliveries,
                totalProducts, outOfStockProducts,
                activeSchedules, activeTargets,
            ] = coreCounts;

            const [totalOrders, toInvoice, openInvoices, creditNotes, approvedShops] = financialCounts;

            Object.assign(this.state.kpis, {
                totalZones: zones,
                totalRoutes: routes,
                totalShops: shops,
                pendingShops: pendingShops,
                totalBookers,
                onlineBookers,
                todayCheckins,
                todayOrders,
                pendingDeliveries,
                totalProducts,
                outOfStockProducts,
                activeSchedules,
                activeTargets,
                totalOrders,
                toInvoice,
                openInvoices,
                creditNotes,
                approvedShops,
            });
        } catch (error) {
            console.error("Failed to fetch Master KPIs", error);
        } finally {
            this.state.isLoadingKpis = false;
        }
    }
    get hasFinancialAccess() {
        return hasFinancialAccess();
    }

    async toggleMenu(menuName, defaultSubTab = '') {
        const isCurrentlyOpen = this.state.expandedMenus[menuName];
        
        // 1. Close ALL menus first (Exclusive Accordion Logic)
        for (let key in this.state.expandedMenus) {
            this.state.expandedMenus[key] = false;
        }
        
        // 2. Toggle the specific menu that was clicked
        this.state.expandedMenus[menuName] = !isCurrentlyOpen;
        
        // 3. If opening, yield to the browser instantly so the accordion animation starts, THEN switch tabs
        if (this.state.expandedMenus[menuName]) {
            await new Promise(resolve => setTimeout(resolve, 10));
            await this.switchTab(menuName, defaultSubTab); 
        }
    }
    async switchTab(tabName, subTabName = '') {
        if (!this.hasFinancialAccess && (tabName === 'financials' || tabName === 'transactions')) {
            tabName = 'operations';
            subTabName = 'checkins';
        }
        if (!this.hasFinancialAccess && tabName === 'warehouse' && ['inventory', 'taxes'].includes(subTabName)) {
            subTabName = 'management';
        }

        // SMART FIX: If we are already on this main tab, don't unmount! Just change the sub-tab gracefully.
        if (this.state.activeTab === tabName) {
            this.state.activeSubTab = subTabName;
            
            // Manage accordion highlighting
            for (let key in this.state.expandedMenus) {
                this.state.expandedMenus[key] = false;
            }
            if (this.state.expandedMenus[tabName] !== undefined) {
                this.state.expandedMenus[tabName] = true;
            }
            this.state.isSidebarOpen = false;
            return; // Exit early, no unmounting needed!
        }

        // 1. Unmount the heavy components and show the loading screen
        this.state.isSwitchingTab = true;

        // 2. Force the browser to paint the UI before locking the thread
        await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 10)));

        try {
            this.state.activeTab = tabName;
            this.state.activeSubTab = subTabName;
            
            for (let key in this.state.expandedMenus) {
                this.state.expandedMenus[key] = false;
            }
            if (this.state.expandedMenus[tabName] !== undefined) {
                this.state.expandedMenus[tabName] = true;
            }
            this.state.isSidebarOpen = false;

            // 3. Yield once more so Owl can begin mounting the new component
            await new Promise(resolve => setTimeout(resolve, 10));

            if (tabName === 'overview') {
                await this.fetchMasterKPIs();
            }
        } finally {
            // 4. Remove the loading screen
            this.state.isSwitchingTab = false;
        }
    }
    toggleSidebar() {
        this.state.isSidebarOpen = !this.state.isSidebarOpen;
    }
}

ShahtajDashboard.template = "shahtaj_oil.DashboardViewTemplate";
registry.category("actions").add("shahtaj_dashboard_tag", ShahtajDashboard);