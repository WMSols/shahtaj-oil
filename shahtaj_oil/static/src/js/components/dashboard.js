/** @odoo-module **/

import { Component, useState, onWillStart, onMounted, onWillUnmount, useRef, useEffect } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { registry } from "@web/core/registry";
import { loadBundle, loadJS } from "@web/core/assets";
import {
    canMutate,
    canSee,
    canSeeCard,
    defaultDeliveriesSub,
    defaultHome,
    defaultStaffRole,
    firstAllowedSub,
    hasFinancialAccess,
    loadPortalAccess,
    portalTitle,
    resetPortalBusy,
    showPrices,
} from "../shahtaj_access";
import { StaffManagement } from "./staff_management";
import { OperationsTracking } from "./operations/operations_tracking";
import { DeliveryManPerformance } from "./delivery_man_performance";
import { TerritoryRoutes } from "./territory/territory_routes";
import { WarehouseInventory } from "./warehouse_inventory";
import { FinancialsInvoicing } from "./financials/financials_invoicing";
import { PortalSettings } from "./settings"
import { SchedulesTargets } from "./schedules_targets";
import { BankTransactions } from "./bank_transactions";
import { Accounting } from "./accounting";
import { FieldReports } from "./field_reports";
import { ConfirmModal } from "./confirm_modal";

export class ShahtajDashboard extends Component {
    static components = { StaffManagement, OperationsTracking, DeliveryManPerformance, TerritoryRoutes, WarehouseInventory, FinancialsInvoicing, PortalSettings, SchedulesTargets, BankTransactions, Accounting, FieldReports, ConfirmModal }; 

    setup() {
        this.orm = useService("orm");
        this.cashChartRef = useRef("cashChart");
        this.cashChart = null;
        this._cashChartToken = 0;
        this._opsLoadToken = 0;
        this._cashLoadToken = 0;
        this._kpiLoadToken = 0;
        this._navToken = 0;
        const today = new Date();
        this.todayStr = this._formatDate(today);

        this.state = useState({
            activeTab: 'overview', // Default to the new Master Overview
            activeSubTab: '',
            renderedTab: 'overview',
            renderedSubTab: '',
            staffRole: 'order_booker',
            deliveriesSubTab: '',
            checkinPurpose: 'all',
            checkinRole: 'all',
            checkinDate: '',
            shopStatus: 'all',
            shopRegisteredOn: '',
            shopRegistrar: 'all',
            staffStatus: 'all',
            stockStatus: 'all',
            orderDate: '',
            dispatchDate: '',
            dmDate: '',
            dmFieldState: 'all',
            dmState: 'all',
            invoiceStatus: 'all',
            cashDirection: 'all',
            cashDateFrom: '',
            cashDateTo: '', 
            isSidebarOpen: false, 
            isSwitchingTab: false,
            isSidebarLocked: false,
            isLoadingKpis: false,
            isLoadingOps: false,
            isLoadingCash: false,
            cashRangeDays: 30,
            shopRegDate: this.todayStr,
            opsDate: this.todayStr,
            // Master KPI State
            kpis: {
                totalZones: 0,
                totalRoutes: 0,
                totalShops: 0,
                pendingShops: 0,
                shopsRegisteredByOb: 0,
                totalBookers: 0,
                onlineBookers: 0,
                todayCheckins: 0,
                todayOrders: 0,
                todayDeliveries: 0,
                todayInTransit: 0,
                pendingDeliveries: 0,
                totalDeliveryMen: 0,
                onlineDeliveryMen: 0,
                dmJobsToday: 0,
                dmJobsActive: 0,
                dmInTransit: 0,
                ordersToDispatch: 0,
                totalProducts: 0,
                outOfStockProducts: 0,
                activeSchedules: 0,
                activeTargets: 0,
                totalOrders: 0,
                toInvoice: 0,
                openInvoices: 0,
                creditNotes: 0,
                vendorBills: 0,
                cashIn: 0,
                cashOut: 0,
                netCash: 0,
                stillOwed: 0,
                cashTrend: { labels: [], cashIn: [], cashOut: [] },
            },
            // Tracks which accordion menus are currently expanded
            expandedMenus: {
                territory: false,
                warehouse: false,
                operations: false,
                financials: false,
                schedules: false,
                reports: false,
                accounting: false,
            }
        });
        // Global Event listnere to sync child component tab switches with the main dashboard state
        window.addEventListener('shahtaj-dashboard-switch', (ev) => {
            if (ev.detail.staffRole) {
                this.state.staffRole = ev.detail.staffRole;
            }
            if (ev.detail.deliveriesSubTab) {
                this.state.deliveriesSubTab = ev.detail.deliveriesSubTab;
            }
            const filters = {};
            if (ev.detail.checkinPurpose || ev.detail.checkinRole || ev.detail.checkinDate) {
                filters.checkinPurpose = ev.detail.checkinPurpose || 'all';
                filters.checkinRole = ev.detail.checkinRole || 'all';
                filters.checkinDate = ev.detail.checkinDate || '';
            }
            this.switchTab(ev.detail.tab, ev.detail.subTab, { filters });
        });
        onWillStart(async () => {
            await loadPortalAccess();
            this.state.staffRole = defaultStaffRole();
            this.state.deliveriesSubTab = defaultDeliveriesSub();
        });
        onMounted(() => {
            if (this.canSeeCard("financials")) {
                this.ensureChartJs();
            }
            this.fetchMasterKPIs();
        });
        useEffect(
            () => {
                this.renderCashChart();
            },
            () => [
                this.state.activeTab,
                this.state.isSwitchingTab,
                this._cashTrendKey(),
            ]
        );
        this._cursorX = null;
        this._cursorY = null;
        this._cursorHold = null;
        this._cursorReleaseArmed = false;
        this._sawPortalBusy = false;
        this._onCursorPointerMove = (ev) => {
            this._cursorX = ev.clientX;
            this._cursorY = ev.clientY;
            if (this._cursorHold && ev.target !== this._cursorHold) {
                this._cursorHold.style.removeProperty("cursor");
                this._cursorHold = null;
            }
            if (!this._cursorReleaseArmed || this.portalWaitCursor) {
                return;
            }
            this._cursorReleaseArmed = false;
            const style = document.getElementById("so-portal-cursor");
            if (style) {
                style.textContent = "";
            }
        };
        window.addEventListener("pointermove", this._onCursorPointerMove, true);
        useEffect(
            () => {
                if (this.portalWaitCursor) {
                    this._sawPortalBusy = true;
                    this._applyPortalCursor(true);
                    return;
                }
                if (!this._sawPortalBusy) {
                    return;
                }
                this._applyPortalCursor(false);
                const frame = requestAnimationFrame(() => {
                    if (!this.portalWaitCursor) {
                        this._cursorReleaseArmed = true;
                    }
                });
                return () => cancelAnimationFrame(frame);
            },
            () => [this.portalWaitCursor]
        );
        this._onPortalBusy = (ev) => {
            this.state.isSidebarLocked = Boolean(ev.detail?.busy);
        };
        window.addEventListener("shahtaj-portal-busy", this._onPortalBusy);
        onWillUnmount(() => {
            window.removeEventListener("shahtaj-portal-busy", this._onPortalBusy);
            window.removeEventListener("pointermove", this._onCursorPointerMove, true);
            if (this._cursorHold) {
                this._cursorHold.style.removeProperty("cursor");
                this._cursorHold = null;
            }
            document.getElementById("so-portal-cursor")?.remove();
            resetPortalBusy();
            this.destroyCashChart();
        });
        
    }

    _formatDate(d) {
        const year = d.getFullYear();
        const month = String(d.getMonth() + 1).padStart(2, '0');
        const day = String(d.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    /**
     * Convert a Pakistan calendar date (YYYY-MM-DD) to Odoo UTC naive bounds.
     * PKT day 2026-08-19 is 2026-08-18 19:00:00 UTC through 2026-08-19 18:59:59 UTC.
     */
    _pktDateToUtcBounds(dateStr) {
        const start = new Date(`${dateStr}T00:00:00+05:00`);
        const end = new Date(`${dateStr}T23:59:59+05:00`);
        const toOdooUtc = (d) => d.toISOString().slice(0, 19).replace("T", " ");
        return { start: toOdooUtc(start), end: toOdooUtc(end) };
    }

    _shopRegDomain(dateStr) {
        const bounds = this._pktDateToUtcBounds(dateStr || this.todayStr);
        return [
            ["is_shahtaj_shop", "=", true],
            ["registered_by_id", "!=", false],
            ["registered_by_id.shahtaj_is_order_booker", "=", true],
            ["create_date", ">=", bounds.start],
            ["create_date", "<=", bounds.end],
        ];
    }

    _parseDayKey(value) {
        if (!value) {
            return "";
        }
        return String(value).slice(0, 10);
    }

    _buildDayKeys(fromStr, toStr) {
        const keys = [];
        const cursor = new Date(`${fromStr}T00:00:00`);
        const end = new Date(`${toStr}T00:00:00`);
        while (cursor <= end) {
            keys.push(this._formatDate(cursor));
            cursor.setDate(cursor.getDate() + 1);
        }
        return keys;
    }

    _getCashDateRange() {
        const days = this.state.cashRangeDays || 30;
        const to = new Date();
        const from = new Date(to.getFullYear(), to.getMonth(), to.getDate() - (days - 1));
        return { from: this._formatDate(from), to: this._formatDate(to) };
    }

    _labelForDay(dayKey) {
        const date = new Date(`${dayKey}T00:00:00`);
        return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    }

    _cashTrendKey() {
        const trend = this.state.kpis.cashTrend || {};
        return [
            (trend.labels || []).join("\u001f"),
            (trend.cashIn || []).join("\u001f"),
            (trend.cashOut || []).join("\u001f"),
        ].join("\u001e");
    }

    formatMoney(value) {
        const amount = Number(value) || 0;
        const abs = Math.abs(amount).toLocaleString(undefined, {
            minimumFractionDigits: 0,
            maximumFractionDigits: 0,
        });
        return amount < 0 ? `Rs. -${abs}` : `Rs. ${abs}`;
    }
    
    async _count(model, domain) {
        try {
            return await this.orm.searchCount(model, domain);
        } catch (error) {
            console.error("KPI count failed", model, error);
            return 0;
        }
    }

    async fetchMasterKPIs() {
        const token = ++this._kpiLoadToken;
        const opsDate = this.state.opsDate;
        const shopRegDate = this.state.shopRegDate;
        const cashRangeDays = this.state.cashRangeDays;
        this.state.isLoadingKpis = true;
        let opsBounds;
        try {
            opsBounds = this._pktDateToUtcBounds(opsDate || this.todayStr);
        } catch (error) {
            console.error("Failed to fetch Master KPIs", error);
            if (token === this._kpiLoadToken) {
                this.state.isLoadingKpis = false;
            }
            return;
        }
        const productBaseDomain = [
            ["sale_ok", "=", true],
            ["default_code", "!=", "SHAHTAJ-LEGACY"],
            ["active", "=", true],
        ];
        const next = {};

        try {
            const jobs = [];
            if (this.canSeeCard("territory")) {
                jobs.push((async () => {
                    const [zones, routes, shops, pendingShops, shopsRegisteredByOb] = await Promise.all([
                        this._count("shahtaj.zone", [["active", "=", true]]),
                        this._count("shahtaj.route", [["active", "=", true]]),
                        this._count("res.partner", [["is_shahtaj_shop", "=", true], ["active", "=", true]]),
                        this._count("res.partner", [["is_shahtaj_shop", "=", true], ["active", "=", true], ["shop_approval_state", "=", "pending"]]),
                        this._count("res.partner", this._shopRegDomain(shopRegDate)),
                    ]);
                    Object.assign(next, { totalZones: zones, totalRoutes: routes, totalShops: shops, pendingShops, shopsRegisteredByOb });
                })());
            }
            if (this.canSeeCard("staffBookers")) {
                jobs.push((async () => {
                    const [totalBookers, onlineBookers] = await Promise.all([
                        this._count("res.users", [["shahtaj_is_order_booker", "=", true], ["active", "=", true]]),
                        this._count("res.users", [["shahtaj_is_order_booker", "=", true], ["active", "=", true], ["shahtaj_online_status", "=", "online"]]),
                    ]);
                    Object.assign(next, { totalBookers, onlineBookers });
                })());
            }
            if (this.canSeeCard("checkins")) {
                jobs.push((async () => {
                    next.todayCheckins = await this._count("shahtaj.gps.attempt", [
                        ["purpose", "=", "check_in"],
                        ["create_date", ">=", opsBounds.start],
                        ["create_date", "<=", opsBounds.end],
                    ]);
                })());
            }
            if (this.canSeeCard("orders")) {
                jobs.push((async () => {
                    next.todayOrders = await this._count("sale.order", [
                        ["shahtaj_visit_id", "!=", false],
                        ["date_order", ">=", opsBounds.start],
                        ["date_order", "<=", opsBounds.end],
                    ]);
                })());
            }
            if (this.canSeeCard("dispatch")) {
                jobs.push((async () => {
                    const [todayDeliveries, ordersToDispatch] = await Promise.all([
                        this._count("sale.order", this._toDispatchDomain(opsDate)),
                        this._count("sale.order", [
                            ["state", "in", ["sale", "done"]],
                            ["shahtaj_delivery_status", "in", ["pending", "partial"]],
                            ["shahtaj_qty_to_deliver", ">", 0],
                            ["shahtaj_dm_delivery_ids", "=", false],
                        ]),
                    ]);
                    Object.assign(next, { todayDeliveries, ordersToDispatch });
                })());
            }
            if (this.canSeeCard("warehouse")) {
                jobs.push((async () => {
                    const [totalProducts, outOfStockProducts] = await Promise.all([
                        this._count("product.template", productBaseDomain),
                        this._count("product.template", [...productBaseDomain, ["qty_available", "<=", 0]]),
                    ]);
                    Object.assign(next, { totalProducts, outOfStockProducts });
                })());
            }
            if (this.canSeeCard("schedules")) {
                jobs.push((async () => {
                    const [activeSchedules, activeTargets] = await Promise.all([
                        this._count("shahtaj.weekly.schedule", [["active", "=", true]]),
                        this._count("shahtaj.visit.target", [["active", "=", true]]),
                    ]);
                    Object.assign(next, { activeSchedules, activeTargets });
                })());
            }
            if (this.canSeeCard("deliveryMen")) {
                jobs.push((async () => {
                    const [totalDeliveryMen, onlineDeliveryMen] = await Promise.all([
                        this._count("res.users", [["shahtaj_is_delivery_man", "=", true], ["active", "=", true]]),
                        this._count("res.users", [["shahtaj_is_delivery_man", "=", true], ["active", "=", true], ["shahtaj_online_status", "=", "online"]]),
                    ]);
                    Object.assign(next, { totalDeliveryMen, onlineDeliveryMen });
                })());
            }
            if (this.canSeeCard("deliveryJobs")) {
                jobs.push((async () => {
                    const [dmJobsToday, todayInTransit, pendingDeliveries, dmJobsActive, dmInTransit] = await Promise.all([
                        this._count("shahtaj.dm.delivery", [["scheduled_date", "=", opsDate], ["state", "!=", "not_ready"]]),
                        this._count("shahtaj.dm.delivery", [["scheduled_date", "=", opsDate], ["field_state", "=", "in_transit"]]),
                        this._count("shahtaj.dm.delivery", [["field_state", "=", "pending"]]),
                        this._count("shahtaj.dm.delivery", [["state", "in", ["ready", "picked", "partial"]]]),
                        this._count("shahtaj.dm.delivery", [["field_state", "=", "in_transit"]]),
                    ]);
                    Object.assign(next, { dmJobsToday, todayInTransit, pendingDeliveries, dmJobsActive, dmInTransit });
                })());
            }
            if (this.canSeeCard("invoices")) {
                jobs.push((async () => {
                    Object.assign(next, await this.fetchInvoiceOverview());
                })());
            }
            if (this.canSeeCard("financials")) {
                jobs.push((async () => {
                    Object.assign(next, await this.fetchCashOverview());
                })());
            }
            await Promise.all(jobs);
            if (token !== this._kpiLoadToken) {
                return;
            }
            if (opsDate !== this.state.opsDate) {
                delete next.todayCheckins;
                delete next.todayOrders;
                delete next.todayDeliveries;
                delete next.dmJobsToday;
                delete next.todayInTransit;
            }
            if (shopRegDate !== this.state.shopRegDate) {
                delete next.shopsRegisteredByOb;
            }
            if (cashRangeDays !== this.state.cashRangeDays) {
                delete next.cashIn;
                delete next.cashOut;
                delete next.netCash;
                delete next.stillOwed;
                delete next.cashTrend;
            }
            Object.assign(this.state.kpis, next);
        } catch (error) {
            console.error("Failed to fetch Master KPIs", error);
        } finally {
            if (token === this._kpiLoadToken) {
                this.state.isLoadingKpis = false;
            }
        }
    }

    async fetchInvoiceOverview() {
        const [totalOrders, toInvoice, openInvoices, creditNotes, vendorBills] = await Promise.all([
            this._count("sale.order", [["shahtaj_visit_id", "!=", false]]),
            this._count("sale.order", [["shahtaj_visit_id", "!=", false], ["invoice_status", "=", "to invoice"]]),
            this._count("account.move", [["move_type", "in", ["out_invoice"]], ["partner_id.is_shahtaj_shop", "=", true], ["state", "=", "posted"], ["payment_state", "in", ["not_paid", "partial"]]]),
            this._count("account.move", [["move_type", "=", "out_refund"], ["partner_id.is_shahtaj_shop", "=", true]]),
            this.canSee("financials", "vendor_bills")
                ? this._count("account.move", [["move_type", "in", ["in_invoice", "in_refund"]], ["state", "in", ["draft", "posted"]]])
                : Promise.resolve(0),
        ]);
        return { totalOrders, toInvoice, openInvoices, creditNotes, vendorBills };
    }

    async fetchCashOverview() {
        const { from, to } = this._getCashDateRange();
        const dayKeys = this._buildDayKeys(from, to);
        const byDay = {};
        for (const key of dayKeys) {
            byDay[key] = { cashIn: 0, cashOut: 0 };
        }

        const paymentDomain = [
            ["journal_id.type", "in", ["bank", "cash"]],
            ["date", ">=", from],
            ["date", "<=", to],
            ["state", "in", ["paid", "in_process", "posted", "reconciled"]],
        ];

        let payments = [];
        let shopsData = [];
        try {
            [payments, shopsData] = await Promise.all([
                this.orm.searchRead("account.payment", paymentDomain, ["date", "amount", "amount_signed", "payment_type"], { limit: 10000 }),
                this.orm.searchRead("res.partner", [["is_shahtaj_shop", "=", true], ["shop_approval_state", "=", "approved"]], ["outstanding_balance"], { limit: 10000 }),
            ]);
        } catch (error) {
            console.error("Failed to fetch cash overview", error);
        }

        let cashIn = 0;
        let cashOut = 0;
        for (const payment of payments || []) {
            const amount = Math.abs(payment.amount_signed || payment.amount || 0);
            const day = this._parseDayKey(payment.date);
            if (payment.payment_type === "outbound") {
                cashOut += amount;
                if (byDay[day]) {
                    byDay[day].cashOut += amount;
                }
            } else {
                cashIn += amount;
                if (byDay[day]) {
                    byDay[day].cashIn += amount;
                }
            }
        }

        const stillOwed = (shopsData || []).reduce((sum, shop) => sum + (shop.outstanding_balance || 0), 0);

        return {
            cashIn,
            cashOut,
            netCash: cashIn - cashOut,
            stillOwed,
            cashTrend: {
                labels: dayKeys.map((key) => this._labelForDay(key)),
                cashIn: dayKeys.map((key) => byDay[key].cashIn),
                cashOut: dayKeys.map((key) => byDay[key].cashOut),
            },
        };
    }

    async onOpsDateChange(ev) {
        const dateStr = ev.target.value;
        if (!dateStr || dateStr === this.state.opsDate) {
            return;
        }
        this.state.opsDate = dateStr;
        const token = ++this._opsLoadToken;
        this.state.isLoadingOps = true;
        const opsBounds = this._pktDateToUtcBounds(dateStr);
        try {
            const [todayCheckins, todayOrders, todayDeliveries, dmJobsToday, todayInTransit] = await Promise.all([
                this.canSeeCard("checkins") ? this._count("shahtaj.gps.attempt", [
                    ["purpose", "=", "check_in"],
                    ["create_date", ">=", opsBounds.start],
                    ["create_date", "<=", opsBounds.end],
                ]) : Promise.resolve(this.state.kpis.todayCheckins),
                this.canSeeCard("orders") ? this._count("sale.order", [["shahtaj_visit_id", "!=", false], ["date_order", ">=", opsBounds.start], ["date_order", "<=", opsBounds.end]]) : Promise.resolve(this.state.kpis.todayOrders),
                this.canSeeCard("dispatch") ? this._count("sale.order", this._toDispatchDomain(dateStr)) : Promise.resolve(this.state.kpis.todayDeliveries),
                this.canSeeCard("deliveryJobs") ? this._count("shahtaj.dm.delivery", [["scheduled_date", "=", dateStr], ["state", "!=", "not_ready"]]) : Promise.resolve(this.state.kpis.dmJobsToday),
                this.canSeeCard("deliveryJobs") ? this._count("shahtaj.dm.delivery", [["scheduled_date", "=", dateStr], ["field_state", "=", "in_transit"]]) : Promise.resolve(this.state.kpis.todayInTransit),
            ]);
            if (token !== this._opsLoadToken) {
                return;
            }
            Object.assign(this.state.kpis, {
                todayCheckins,
                todayOrders,
                todayDeliveries,
                dmJobsToday,
                todayInTransit,
            });
        } catch (error) {
            console.error("Failed to fetch field activity counts", error);
        } finally {
            if (token === this._opsLoadToken) {
                this.state.isLoadingOps = false;
            }
        }
    }

    async onShopRegDateChange(ev) {
        const dateStr = ev.target.value;
        if (!dateStr || dateStr === this.state.shopRegDate) {
            return;
        }
        this.state.shopRegDate = dateStr;
        try {
            this.state.kpis.shopsRegisteredByOb = await this.orm.searchCount(
                "res.partner",
                this._shopRegDomain(dateStr),
            );
        } catch (error) {
            console.error("Failed to fetch shop registration count", error);
        }
    }

    async setCashRangeDays(days) {
        if (this.state.cashRangeDays === days) {
            return;
        }
        this.state.cashRangeDays = days;
        const token = ++this._cashLoadToken;
        this.state.isLoadingCash = true;
        try {
            const financial = await this.fetchCashOverview();
            if (token !== this._cashLoadToken) {
                return;
            }
            Object.assign(this.state.kpis, financial);
        } catch (error) {
            console.error("Failed to fetch financial overview", error);
        } finally {
            if (token === this._cashLoadToken) {
                this.state.isLoadingCash = false;
            }
        }
    }

    async ensureChartJs() {
        if (window.Chart) {
            return window.Chart.default || window.Chart;
        }
        try {
            await loadBundle("web.chartjs_lib");
        } catch (_error) {
            await loadJS("/web/static/lib/Chart/Chart.js");
        }
        return window.Chart?.default || window.Chart;
    }

    destroyCashChart() {
        if (this.cashChart) {
            this.cashChart.destroy();
            this.cashChart = null;
        }
    }

    _applyCashTrend(chart, trend) {
        chart.data.labels = (trend.labels || []).slice();
        chart.data.datasets[0].data = (trend.cashIn || []).slice();
        chart.data.datasets[1].data = (trend.cashOut || []).slice();
        chart.update();
    }

    async renderCashChart() {
        if (!this.canSeeCard("financials") || this.state.activeTab !== "overview" || this.state.isSwitchingTab) {
            this.destroyCashChart();
            return;
        }
        const canvas = this.cashChartRef.el;
        if (!canvas) {
            return;
        }
        const trend = this.state.kpis.cashTrend || { labels: [], cashIn: [], cashOut: [] };
        if (this.cashChart && this.cashChart.canvas === canvas) {
            this._cashChartToken += 1;
            this._applyCashTrend(this.cashChart, trend);
            return;
        }
        this._cashChartToken += 1;
        const token = this._cashChartToken;
        const ChartLib = await this.ensureChartJs();
        if (!ChartLib || token !== this._cashChartToken || this.cashChartRef.el !== canvas) {
            return;
        }
        this.destroyCashChart();
        this.cashChart = new ChartLib(canvas, {
            type: "bar",
            data: {
                labels: trend.labels,
                datasets: [
                    {
                        label: "Cash in",
                        data: trend.cashIn,
                        backgroundColor: "rgba(250, 204, 21, 0.95)",
                        borderRadius: 4,
                        maxBarThickness: 18,
                    },
                    {
                        label: "Cash out",
                        data: trend.cashOut,
                        backgroundColor: "rgba(29, 78, 216, 0.88)",
                        borderRadius: 4,
                        maxBarThickness: 18,
                    },
                ],
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: "index", intersect: false },
                plugins: {
                    legend: {
                        labels: {
                            color: "#1e3a8a",
                            boxWidth: 12,
                            font: { weight: "600" },
                        },
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.dataset.label}: ${this.formatMoney(context.parsed.y)}`,
                        },
                    },
                },
                scales: {
                    x: {
                        ticks: { color: "#1e40af", maxRotation: 0, autoSkip: true, maxTicksLimit: 10 },
                        grid: { display: false },
                    },
                    y: {
                        beginAtZero: true,
                        ticks: {
                            color: "#1e40af",
                            callback: (value) => this.formatMoney(value),
                        },
                        grid: { color: "rgba(30, 64, 175, 0.12)" },
                    },
                },
            },
        });
    }
    get hasFinancialAccess() {
        return hasFinancialAccess();
    }

    get canMutate() {
        return canMutate();
    }

    get showPrices() {
        return showPrices();
    }

    get portalTitle() {
        return portalTitle();
    }

    canSee(tab, subTab = "", inner = "") {
        return canSee(tab, subTab, inner);
    }

    canSeeMenu(tab) {
        return canSee(tab);
    }

    canSeeCard(card) {
        return canSeeCard(card);
    }

    get contentReady() {
        return this.state.renderedTab === this.state.activeTab
            && (this.state.renderedSubTab || "") === (this.state.activeSubTab || "");
    }

    get portalWaitCursor() {
        if (this.state.isSwitchingTab || this.state.isSidebarLocked) {
            return true;
        }
        if (!this.contentReady || this.state.renderedTab !== "overview") {
            return false;
        }
        return this.state.isLoadingKpis
            || this.state.isLoadingOps
            || this.state.isLoadingCash;
    }

    _applyPortalCursor(wait) {
        let style = document.getElementById("so-portal-cursor");
        if (!style) {
            style = document.createElement("style");
            style.id = "so-portal-cursor";
            document.head.appendChild(style);
        }
        this._cursorReleaseArmed = false;
        if (this._cursorHold) {
            this._cursorHold.style.removeProperty("cursor");
            this._cursorHold = null;
        }
        if (wait) {
            style.textContent = "html, html * { cursor: wait !important; }";
            return;
        }
        style.textContent = "html, html * { cursor: default !important; }";
        if (this._cursorX == null) {
            return;
        }
        const hit = document.elementFromPoint(this._cursorX, this._cursorY);
        if (!hit) {
            return;
        }
        hit.style.setProperty("cursor", "default", "important");
        this._cursorHold = hit;
    }

    get showFieldCard() {
        return this.canSeeCard("checkins")
            || this.canSeeCard("orders")
            || this.canSeeCard("dispatch")
            || this.canSeeCard("deliveryJobs");
    }

    get showStaffCard() {
        return this.canSeeCard("staffBookers") || this.canSeeCard("deliveryMen");
    }

    get showMidRow() {
        return this.showStaffCard || this.canSeeCard("warehouse") || this.canSeeCard("schedules");
    }

    get showFinanceRow() {
        return this.canSeeCard("financials") || this.canSeeCard("invoices");
    }

    get overviewSpans() {
        const has = (card) => this.canSeeCard(card);
        const spans = {};
        if (has("territory") && this.showFieldCard) {
            spans.territory = 7;
            spans.field = 5;
        } else if (has("territory")) {
            spans.territory = 12;
        }

        const mid = ["staff", "warehouse", "schedules"].filter((card) => {
            if (card === "staff") return this.showStaffCard;
            return has(card);
        });
        if (mid.length === 3) {
            mid.forEach((card) => { spans[card] = 4; });
        } else if (mid.length === 2) {
            mid.forEach((card) => { spans[card] = 6; });
        } else if (mid.length === 1) {
            spans[mid[0]] = 12;
        }

        if (has("financials") && has("invoices")) {
            spans.financials = 8;
            spans.invoices = 4;
        } else if (has("financials")) {
            spans.financials = 12;
        } else if (has("invoices")) {
            spans.invoices = 12;
        }

        if (this.showFieldCard && !spans.field) {
            const row = ["field"];
            if (mid.length && mid.length < 3) {
                row.push(...mid);
            } else if (!mid.length && has("invoices") && !has("financials")) {
                row.push("invoices");
            }
            const span = Math.floor(12 / row.length);
            const remainder = 12 - span * row.length;
            row.forEach((card, index) => {
                spans[card] = span + (index === row.length - 1 ? remainder : 0);
            });
        }
        return spans;
    }

    overviewSpanClass(card) {
        return `so-ov-span-${this.overviewSpans[card] || 12}`;
    }

    get obMetricColClass() {
        const count = (this.canSeeCard("checkins") ? 1 : 0) + (this.canSeeCard("orders") ? 1 : 0);
        return count <= 1 ? "col-12" : "col-6";
    }

    get dmMetricColClass() {
        const count = (this.canSeeCard("dispatch") ? 1 : 0) + (this.canSeeCard("deliveryJobs") ? 2 : 0);
        if (count <= 1) return "col-12";
        if (count === 2) return "col-6";
        return "col-6 col-sm-4";
    }

    get invoiceMetricColClass() {
        return (this.overviewSpans.invoices || 12) >= 12 ? "col-6 col-xl-3" : "col-6";
    }

    get overviewDateLabel() {
        return new Date().toLocaleDateString("en-GB", {
            weekday: "long",
            day: "numeric",
            month: "long",
            year: "numeric",
        });
    }

    get isOpsDateToday() {
        return (this.state.opsDate || this.todayStr) === this.todayStr;
    }

    get opsDateLabel() {
        if (this.isOpsDateToday) {
            return "today";
        }
        const date = new Date(`${this.state.opsDate}T00:00:00`);
        return date.toLocaleDateString("en-GB", {
            day: "numeric",
            month: "short",
            year: "numeric",
        });
    }

    get onlineBookerPct() {
        const total = this.state.kpis.totalBookers;
        if (!total) {
            return 0;
        }
        return Math.round((this.state.kpis.onlineBookers / total) * 100);
    }

    get onlineFieldPct() {
        const total = this.state.kpis.totalBookers + this.state.kpis.totalDeliveryMen;
        if (!total) {
            return 0;
        }
        return Math.round(((this.state.kpis.onlineBookers + this.state.kpis.onlineDeliveryMen) / total) * 100);
    }

    get inStockProducts() {
        return Math.max(0, this.state.kpis.totalProducts - this.state.kpis.outOfStockProducts);
    }

    get hasAttentionItems() {
        if (this.state.isLoadingKpis) {
            return false;
        }
        const kpis = this.state.kpis;
        return (this.canSeeCard("territory") && kpis.pendingShops > 0)
            || (this.canSeeCard("deliveryJobs") && kpis.pendingDeliveries > 0)
            || (this.canSeeCard("dispatch") && kpis.ordersToDispatch > 0)
            || (this.canSeeCard("deliveryJobs") && kpis.dmInTransit > 0)
            || (this.canSeeCard("warehouse") && kpis.outOfStockProducts > 0)
            || (this.canSeeCard("invoices") && kpis.toInvoice > 0);
    }

    _applyNavFilters(filters = {}) {
        const next = filters || {};
        this.state.shopStatus = next.shopStatus || 'all';
        this.state.shopRegisteredOn = next.shopRegisteredOn || '';
        this.state.shopRegistrar = next.shopRegistrar || 'all';
        this.state.staffStatus = next.staffStatus || 'all';
        this.state.stockStatus = next.stockStatus || 'all';
        this.state.orderDate = next.orderDate || '';
        this.state.dispatchDate = next.dispatchDate || '';
        this.state.dmDate = next.dmDate || '';
        this.state.dmFieldState = next.dmFieldState || 'all';
        this.state.dmState = next.dmState || 'all';
        this.state.invoiceStatus = next.invoiceStatus || 'all';
        this.state.cashDirection = next.cashDirection || 'all';
        this.state.cashDateFrom = next.cashDateFrom || '';
        this.state.cashDateTo = next.cashDateTo || '';
        this.state.checkinPurpose = next.checkinPurpose || 'all';
        this.state.checkinRole = next.checkinRole || 'all';
        this.state.checkinDate = next.checkinDate || '';
    }

    _opsDay() {
        return this.state.opsDate || this.todayStr;
    }

    _toDispatchDomain(dateStr) {
        const bounds = this._pktDateToUtcBounds(dateStr || this._opsDay());
        return [
            "|",
            ["shahtaj_visit_id", "!=", false],
            ["partner_id.is_shahtaj_shop", "=", true],
            ["state", "in", ["sale", "done"]],
            ["shahtaj_delivery_status", "in", ["pending", "partial"]],
            ["shahtaj_qty_to_deliver", ">", 0],
            ["date_order", ">=", bounds.start],
            ["date_order", "<=", bounds.end],
        ];
    }

    openStaff(role = 'order_booker', status = 'all') {
        this.state.staffRole = role;
        this.switchTab('staff', '', { filters: { staffStatus: status } });
    }

    openShops(filters = {}) {
        this.switchTab('territory', 'shops', { filters });
    }

    openRegisteredShops() {
        this.openShops({
            shopRegisteredOn: this.state.shopRegDate || this.todayStr,
            shopRegistrar: 'order_booker',
        });
    }

    openStock(status = 'all') {
        this.switchTab('warehouse', 'management', { filters: { stockStatus: status } });
    }

    openLiveOrders() {
        this.switchTab('operations', 'orders', { filters: { orderDate: this._opsDay() } });
    }

    openDeliveries(subTab = 'dispatch', filters = {}) {
        const forceBusy = this.state.activeTab === 'operations'
            && this.state.activeSubTab === 'deliveries'
            && this.state.deliveriesSubTab !== subTab;
        this.state.deliveriesSubTab = subTab;
        this.switchTab('operations', 'deliveries', { forceBusy, filters });
    }

    openDmOperations() {
        const inner = canSee("operations", "deliveries", "dispatch")
            ? "dispatch"
            : defaultDeliveriesSub();
        this.openDeliveries(inner);
    }

    openToDispatch() {
        this.openDeliveries('dispatch', { dispatchDate: this._opsDay() });
    }

    openDmJobs(extra = {}) {
        this.openDeliveries('jobs', { dmDate: this._opsDay(), ...extra });
    }

    openCheckins() {
        this.switchTab('operations', 'checkins');
    }

    openTodayCheckins() {
        this.switchTab('operations', 'checkins', {
            filters: {
                checkinPurpose: 'check_in',
                checkinRole: 'all',
                checkinDate: this._opsDay(),
            },
        });
    }

    openCash(direction) {
        const { from, to } = this._getCashDateRange();
        this.switchTab('financials', 'cash', {
            filters: {
                cashDirection: direction,
                cashDateFrom: from,
                cashDateTo: to,
            },
        });
    }

    openCustomerInvoices(status = 'all') {
        this.switchTab('financials', 'customer_invoices', { filters: { invoiceStatus: status } });
    }

    toggleMenu(menuName, defaultSubTab = '') {
        const isCurrentlyOpen = this.state.expandedMenus[menuName];
        for (let key in this.state.expandedMenus) {
            this.state.expandedMenus[key] = false;
        }
        this.state.expandedMenus[menuName] = !isCurrentlyOpen;
        if (!this.state.expandedMenus[menuName]) {
            return;
        }
        const sub = (defaultSubTab && canSee(menuName, defaultSubTab))
            ? defaultSubTab
            : firstAllowedSub(menuName);
        this.switchTab(menuName, sub);
    }

    _selectMenu(tabName) {
        for (let key in this.state.expandedMenus) {
            this.state.expandedMenus[key] = false;
        }
        if (this.state.expandedMenus[tabName] !== undefined) {
            this.state.expandedMenus[tabName] = true;
        }
        this.state.isSidebarOpen = false;
    }
    _guardNavigation(tabName, subTabName) {
        if (tabName === 'staff') {
            const role = canSee('staff', this.state.staffRole) ? this.state.staffRole : defaultStaffRole();
            this.state.staffRole = role || defaultStaffRole();
        }
        if (tabName === 'operations' && subTabName === 'all_deliveries') {
            subTabName = 'deliveries';
            this.state.deliveriesSubTab = 'jobs';
        }
        if (tabName === 'operations' && subTabName === 'deliveries') {
            const inner = this.state.deliveriesSubTab || defaultDeliveriesSub();
            this.state.deliveriesSubTab = canSee('operations', 'deliveries', inner)
                ? inner
                : defaultDeliveriesSub();
        }
        const inner = tabName === 'operations' && subTabName === 'deliveries'
            ? this.state.deliveriesSubTab
            : '';
        if (!canSee(tabName, subTabName, inner)) {
            const home = defaultHome();
            return { tabName: home.tab, subTabName: home.sub || '' };
        }
        return { tabName, subTabName };
    }
    async switchTab(tabName, subTabName = '', options = {}) {
        if (tabName === 'staff' && !this.state.staffRole) {
            this.state.staffRole = defaultStaffRole();
        }
        const guarded = this._guardNavigation(tabName, subTabName);
        tabName = guarded.tabName;
        subTabName = guarded.subTabName || '';

        this._applyNavFilters(options.filters);

        const sameTab = this.state.activeTab === tabName;
        const sameSub = sameTab && (this.state.activeSubTab || '') === subTabName;
        this._selectMenu(tabName);
        if (sameSub && !options.forceBusy) {
            return;
        }

        this.state.activeTab = tabName;
        this.state.activeSubTab = subTabName;
        this.state.isSwitchingTab = this.state.renderedTab !== tabName
            || (this.state.renderedSubTab || '') !== subTabName;

        const token = ++this._navToken;
        try {
            await new Promise((resolve) => requestAnimationFrame(resolve));
            if (token !== this._navToken) {
                return;
            }
            this.state.renderedTab = tabName;
            this.state.renderedSubTab = subTabName;
            if (tabName === 'overview') {
                this.fetchMasterKPIs();
            }
        } finally {
            if (token === this._navToken) {
                this.state.isSwitchingTab = false;
            }
        }
    }
    toggleSidebar() {
        this.state.isSidebarOpen = !this.state.isSidebarOpen;
    }
}

ShahtajDashboard.template = "shahtaj_oil.DashboardViewTemplate";
registry.category("actions").add("shahtaj_dashboard_tag", ShahtajDashboard);
