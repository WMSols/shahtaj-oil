/** @odoo-module **/

import { Component, useState, onWillStart } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";

export class OperationsTracking extends Component {
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        this.state = useState({
            // Main Tab Navigation
            activeSubTab: 'orders', // 'checkins', 'orders', 'performance'
            
            selectedOrder: null,    
            selectedCheckin: null,  
            
            itemsPerPage: 5,
            
            deliveryFilters: { search: '', status: '' },
            deliveryPage: 1,
            
            checkinFilters: { search: '', status: '' },
            checkinPage: 1,
            
            orderFilters: { search: '', status: '' },
            orderPage: 1,

            deliveries: [
                { id: "DLV-0091", driver: "Zain Ahmed", route: "Route A - Central", status: "In-Transit", progress: "65%", last_update: "10 mins ago" },
                { id: "DLV-0092", driver: "Fahad Mustafa", route: "Route C - Industrial", status: "Pending", progress: "0%", last_update: "Loading at Hub" },
                { id: "DLV-0093", driver: "Kamran Ali", route: "Route B - North", status: "Delivered", progress: "100%", last_update: "1 hour ago" },
                { id: "DLV-0094", driver: "Bilal Tariq", route: "Route D - South", status: "Returned", progress: "80%", last_update: "Gate Check-in" },
                { id: "DLV-0095", driver: "Adeel Hassan", route: "Route A - Central", status: "In-Transit", progress: "45%", last_update: "2 mins ago" },
                { id: "DLV-0096", driver: "Tariq Mahmood", route: "Route E - Outer", status: "Delivered", progress: "100%", last_update: "30 mins ago" },
                { id: "DLV-0097", driver: "Usman Ali", route: "Route C - Industrial", status: "Pending", progress: "0%", last_update: "Queued" },
                { id: "DLV-0098", driver: "Hamza Farooq", route: "Route B - North", status: "In-Transit", progress: "85%", last_update: "5 mins ago" }
            ],

            checkins: [],
            orders: [],
            isCreatingInvoice: false,

            // --- NEW: PERFORMANCE TRACKING STATES ---
            perfSubTab: 'schedules', // 'schedules', 'targets'
            selectedSchedule: null,
            selectedTarget: null,
            
            // Filters for Schedules
            schedFilterBooker: 'all',
            schedFilterDay: 'all',
            schedFilterDateFrom: '',
            schedFilterDateTo: '',
            
            // Filters for Targets
            targetFilterBooker: 'all',
            targetFilterType: 'all',
            
            bookers: [],
            schedules: [],
            targets: []
        });

        onWillStart(async () => {
            await Promise.all([
                this.fetchLiveVisits(),
                this.fetchLiveOrders(),
                this.fetchPerformanceData()
            ]);
        });
    }

    // --- DATA FETCHING (EXISTING) ---

    async fetchLiveVisits() {
        const visits = await this.orm.searchRead(
            "shahtaj.visit",
            [],
            ["id", "shop_id", "order_booker_id", "started_at", "ended_at", "state", "outcome", "visit_task_id", "sale_order_id"]
        );

        this.state.checkins = visits.map(v => {
            let durationStr = "Active Now";
            if (v.started_at && v.ended_at) {
                const start = new Date(v.started_at.replace(' ', 'T') + "Z");
                const end = new Date(v.ended_at.replace(' ', 'T') + "Z");
                const diffMs = end - start;
                const diffMins = Math.round(diffMs / 60000);
                durationStr = `${diffMins} mins`;
            }

            let displayStatus = 'Unknown';
            if (v.state === 'in_progress') displayStatus = 'Checked In';
            else if (v.state === 'completed') displayStatus = 'Checked Out';
            else if (v.state === 'cancelled') displayStatus = 'Cancelled';

            let displayOutcome = v.outcome;
            if (v.outcome === 'none') displayOutcome = 'In Progress';
            else if (v.outcome === 'order') displayOutcome = 'Order Placed';
            else if (v.outcome === 'no_order') displayOutcome = 'No Order';

            return {
                id: v.id,
                shop: v.shop_id ? v.shop_id[1] : 'Unknown Shop',
                shopId: v.shop_id ? v.shop_id[0] : false,
                booker: v.order_booker_id ? v.order_booker_id[1] : 'Unknown Booker',
                bookerId: v.order_booker_id ? v.order_booker_id[0] : false,
                time: v.started_at || 'Pending',
                endTime: v.ended_at || 'In Progress',
                status: displayStatus,
                duration: durationStr,
                outcome: displayOutcome,
                taskRef: v.visit_task_id ? v.visit_task_id[1] : 'Direct Visit',
                sale_order_id: v.sale_order_id 
            };
        });
    }

    async fetchLiveOrders() {
        const orders = await this.orm.searchRead(
            "sale.order",
            [["shahtaj_visit_id", "!=", false]], 
            ["name", "partner_id", "user_id", "date_order", "amount_total", "state", "order_line", "invoice_status"] 
        );

        this.state.orders = orders.map(o => {
            let status = 'Unknown';
            if (o.state === 'draft') {
                status = 'Draft';
            } else if (o.state === 'sale') {
                if (o.invoice_status === 'to invoice') status = 'To Invoice';
                else if (o.invoice_status === 'invoiced') status = 'Invoiced';
                else status = 'Confirmed'; 
            } else if (o.state === 'done') {
                status = 'Delivered'; 
            }

            return {
                odoo_id: o.id,
                id: o.name,
                shop: o.partner_id ? o.partner_id[1] : 'Unknown Shop',
                partner_id: o.partner_id,
                booker: o.user_id ? o.user_id[1] : 'Unknown Booker',
                address: "Loading...", 
                phone: "Loading...",
                email: "Loading...",
                date: o.date_order || 'Unknown',
                items: o.order_line.length,
                total: `Rs. ${o.amount_total.toLocaleString(undefined, {minimumFractionDigits: 2})}`,
                status: status, 
                invoice_status: o.invoice_status, 
                line_ids: o.order_line,
                lines: [] 
            };
        });
    }

    // --- NEW: PERFORMANCE DATA FETCHING ---
    async fetchPerformanceData() {
        // Load Order Bookers
        const bookers = await this.orm.searchRead('res.users', [['shahtaj_is_order_booker', '=', true]], ['id', 'name']);
        this.state.bookers = bookers;

        // Load All Weekly Schedules
        const scheds = await this.orm.searchRead('shahtaj.weekly.schedule', [], [
            'id', 'name', 'day_of_week', 'route_id', 'zone_id', 'active', 'shop_count',
            'week_tasks_planned', 'week_tasks_completed', 'week_tasks_progress',
            'week_occurrence_date', 'order_booker_id'
        ]);
        const dayMap = { '0': 'Monday', '1': 'Tuesday', '2': 'Wednesday', '3': 'Thursday', '4': 'Friday', '5': 'Saturday', '6': 'Sunday' };
        this.state.schedules = scheds.map(r => ({
            id: r.id,
            name: r.name,
            bookerId: r.order_booker_id ? r.order_booker_id[0] : null,
            bookerName: r.order_booker_id ? r.order_booker_id[1] : 'Unknown Booker',
            day_raw: r.day_of_week,
            day: dayMap[r.day_of_week] || r.day_of_week,
            route: r.route_id ? r.route_id[1] : 'Unassigned',
            zone: r.zone_id ? r.zone_id[1] : 'Unassigned',
            shops: r.shop_count,
            active: r.active,
            planned: r.week_tasks_planned,
            done: r.week_tasks_completed,
            progress: r.week_tasks_progress || 0,
            occurrenceDate: r.week_occurrence_date || ''
        }));

        // Load All Targets
        const tgts = await this.orm.searchRead('shahtaj.visit.target', [], [
            'id', 'name', 'date_start', 'date_end', 'target_type', 'target_value',
            'achieved_value', 'remaining_value', 'progress_percent', 'product_id',
            'currency_id', 'target_weight_uom', 'active', 'order_booker_id'
        ]);
        this.state.targets = tgts.map(r => ({
            id: r.id,
            name: r.name,
            bookerId: r.order_booker_id ? r.order_booker_id[0] : null,
            bookerName: r.order_booker_id ? r.order_booker_id[1] : 'Unknown Booker',
            startDate: r.date_start,
            endDate: r.date_end,
            type: r.target_type,
            displayType: r.target_type ? r.target_type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown',
            targetValue: r.target_value,
            achievedValue: r.achieved_value,
            remainingValue: r.remaining_value,
            progress: r.progress_percent || 0,
            product: r.product_id ? r.product_id[1] : null,
            currency: r.currency_id ? r.currency_id[1] : null,
            weightUom: r.target_weight_uom || '',
            active: r.active
        }));
    }

    // --- NAVIGATION & FILTERS ---

    setSubTab(tabName) {
        this.state.activeSubTab = tabName;
        this.state.selectedOrder = null;
        this.state.selectedCheckin = null;
        this.state.selectedSchedule = null;
        this.state.selectedTarget = null;
    }

    setPerfSubTab(tabName) {
        this.state.perfSubTab = tabName;
        this.state.selectedSchedule = null;
        this.state.selectedTarget = null;
    }

    // Performance Getters
    get filteredSchedules() {
        return this.state.schedules.filter(s => {
            const matchBooker = this.state.schedFilterBooker === 'all' || s.bookerId == this.state.schedFilterBooker;
            const matchDay = this.state.schedFilterDay === 'all' || String(s.day_raw) === this.state.schedFilterDay;
            const matchDateFrom = !this.state.schedFilterDateFrom || s.occurrenceDate >= this.state.schedFilterDateFrom;
            const matchDateTo = !this.state.schedFilterDateTo || s.occurrenceDate <= this.state.schedFilterDateTo;
            return matchBooker && matchDay && matchDateFrom && matchDateTo;
        });
    }

    get filteredTargets() {
        return this.state.targets.filter(t => {
            const matchBooker = this.state.targetFilterBooker === 'all' || t.bookerId == this.state.targetFilterBooker;
            const matchType = this.state.targetFilterType === 'all' || t.type === this.state.targetFilterType;
            return matchBooker && matchType;
        });
    }

    get uniqueTargetTypes() {
        const types = new Set(this.state.targets.map(t => t.type));
        return Array.from(types).map(type => {
            return {
                value: type,
                label: type ? type.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase()) : 'Unknown'
            };
        });
    }

    viewSchedule(sched) { this.state.selectedSchedule = sched; }
    closeSchedule() { this.state.selectedSchedule = null; }

    viewTarget(tgt) { this.state.selectedTarget = tgt; }
    closeTarget() { this.state.selectedTarget = null; }


    // --- ORDERS & CHECK-INS PAGINATION GETTERS (EXISTING) ---
    get filteredDeliveries() {
        return this.state.deliveries.filter(d => {
            const matchSearch = d.driver.toLowerCase().includes(this.state.deliveryFilters.search.toLowerCase()) || 
                                d.id.toLowerCase().includes(this.state.deliveryFilters.search.toLowerCase()) ||
                                d.route.toLowerCase().includes(this.state.deliveryFilters.search.toLowerCase());
            const matchStatus = this.state.deliveryFilters.status ? d.status === this.state.deliveryFilters.status : true;
            return matchSearch && matchStatus;
        });
    }
    get paginatedDeliveries() {
        const start = (this.state.deliveryPage - 1) * this.state.itemsPerPage;
        return this.filteredDeliveries.slice(start, start + this.state.itemsPerPage);
    }
    get deliveryTotalPages() { return Math.max(1, Math.ceil(this.filteredDeliveries.length / this.state.itemsPerPage)); }

    get filteredCheckins() {
        return this.state.checkins.filter(c => {
            const matchSearch = c.shop.toLowerCase().includes(this.state.checkinFilters.search.toLowerCase()) || 
                                c.booker.toLowerCase().includes(this.state.checkinFilters.search.toLowerCase()) ||
                                String(c.shopId || '').includes(this.state.checkinFilters.search) ||
                                String(c.bookerId || '').includes(this.state.checkinFilters.search);
            const matchStatus = this.state.checkinFilters.status ? c.status === this.state.checkinFilters.status : true;
            return matchSearch && matchStatus;
        });
    }
    get paginatedCheckins() {
        const start = (this.state.checkinPage - 1) * this.state.itemsPerPage;
        return this.filteredCheckins.slice(start, start + this.state.itemsPerPage);
    }
    get checkinTotalPages() { return Math.max(1, Math.ceil(this.filteredCheckins.length / this.state.itemsPerPage)); }

    get filteredOrders() {
        return this.state.orders.filter(o => {
            const matchSearch = o.shop.toLowerCase().includes(this.state.orderFilters.search.toLowerCase()) || 
                                o.id.toLowerCase().includes(this.state.orderFilters.search.toLowerCase()) ||
                                o.booker.toLowerCase().includes(this.state.orderFilters.search.toLowerCase()) ||
                                String(o.shopId || '').includes(this.state.orderFilters.search) ||
                                String(o.bookerId || '').includes(this.state.orderFilters.search);
            const matchStatus = this.state.orderFilters.status ? o.status === this.state.orderFilters.status : true;
            return matchSearch && matchStatus;
        });
    }
    get paginatedOrders() {
        const start = (this.state.orderPage - 1) * this.state.itemsPerPage;
        return this.filteredOrders.slice(start, start + this.state.itemsPerPage);
    }
    get orderTotalPages() { return Math.max(1, Math.ceil(this.filteredOrders.length / this.state.itemsPerPage)); }

    changePage(type, direction) {
        if (type === 'delivery') {
            const newPage = this.state.deliveryPage + direction;
            if (newPage >= 1 && newPage <= this.deliveryTotalPages) this.state.deliveryPage = newPage;
        } else if (type === 'checkin') {
            const newPage = this.state.checkinPage + direction;
            if (newPage >= 1 && newPage <= this.checkinTotalPages) this.state.checkinPage = newPage;
        } else if (type === 'order') {
            const newPage = this.state.orderPage + direction;
            if (newPage >= 1 && newPage <= this.orderTotalPages) this.state.orderPage = newPage;
        }
    }

    // --- ORDER ACTIONS (EXISTING) ---
    async viewOrder(order) { 
        this.state.selectedOrder = order; 
        
        if (order.line_ids && order.line_ids.length > 0 && order.lines.length === 0) {
            const lines = await this.orm.searchRead(
                "sale.order.line",
                [["id", "in", order.line_ids]],
                ["name", "product_uom_qty", "product_uom_id", "price_unit", "price_subtotal"] 
            );
            
            order.lines = lines.map(l => ({
                product: l.name,
                qty: l.product_uom_qty,
                unit: l.product_uom_id ? l.product_uom_id[1] : 'Units',
                price: l.price_unit.toLocaleString(undefined, {minimumFractionDigits: 2}),
                subtotal: l.price_subtotal.toLocaleString(undefined, {minimumFractionDigits: 2})
            }));
        }

        if (order.partner_id && order.phone === "Loading...") {
            const partners = await this.orm.searchRead(
                "res.partner",
                [["id", "=", order.partner_id[0]]],
                ["phone", "email", "street", "city"]
            );
            if (partners.length > 0) {
                const p = partners[0];
                order.phone = p.phone || 'N/A';
                order.email = p.email || 'N/A';
                order.address = [p.street, p.city].filter(Boolean).join(', ') || 'No address provided';
            }
        }
    }
    
    closeOrder() { this.state.selectedOrder = null; }

    viewCheckin(log) { this.state.selectedCheckin = log; }
    closeCheckin() { this.state.selectedCheckin = null; }

    async viewOrderFromCheckin(log) {
        if (log.sale_order_id) {
            let targetOrder = this.state.orders.find(o => o.odoo_id === log.sale_order_id[0]);
            
            if (!targetOrder) {
                await this.fetchLiveOrders();
                targetOrder = this.state.orders.find(o => o.odoo_id === log.sale_order_id[0]);
            }
            
            if (targetOrder) {
                this.setSubTab('orders');
                await this.viewOrder(targetOrder);
            }
        }
    }

    async createInvoice() {
        if (!this.state.selectedOrder || this.state.isCreatingInvoice) return;

        this.state.isCreatingInvoice = true;
        
        try {
            await this.orm.call("sale.order", "action_create_invoice_portal", [[this.state.selectedOrder.odoo_id]]);
            
            this.notification.add(`Draft invoice generated for ${this.state.selectedOrder.id}.`, {
                title: "Success",
                type: "success",
            });

            this.state.selectedOrder.invoice_status = 'invoiced';
            this.state.selectedOrder.status = 'Invoiced'; 
            
            this.fetchLiveOrders();

        } catch (error) {
            this.notification.add(error.data?.message || "Failed to create invoice.", {
                title: "Action Failed",
                type: "danger",
            });
        } finally {
            this.state.isCreatingInvoice = false;
        }
    }
}

OperationsTracking.template = "shahtaj_oil.OperationsTracking";