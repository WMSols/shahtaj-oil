/** @odoo-module **/

import { Component, useState, onWillStart, onWillUpdateProps, onMounted, onWillUnmount, markup } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { ConfirmModal } from "./confirm_modal";
import { hasFinancialAccess, notifyPortalBusy } from "../shahtaj_access";

export class StaffManagement extends Component {
    static components = { ConfirmModal };
    static props = {
        requestedStaffRole: { type: String, optional: true },
        requestedShowCreate: { type: Boolean, optional: true },
    };
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        const ITEMS_PER_PAGE = 10;
        const initialRole = this.props.requestedStaffRole === "delivery_man"
            ? "delivery_man"
            : "order_booker";
        this.state = useState({
            activeTab: initialRole,
            viewMode: "list",
            detailTab: "schedules",
            selectedStaff: null,
            showForm: false,
            isLoading: false,
            showPassword: false,
            editingStaffId: null,

            detailSchedules: [],
            detailTargets: [],
            detailJobs: [],
            detailBookers: [],
            coverageBookerIds: [],
            lookupBookers: [],
            vanSnapshot: {
                qtyOnHand: 0,
                skuCount: 0,
                onVanForShops: 0,
                pickedToday: 0,
                deliveredToday: 0,
            },
            vanStockHtml: "",
            recentActivityHtml: "",
            detailDispatch: [],
            lookupDeliveryMen: [],
            assignModal: {
                open: false,
                wizardId: null,
                orderName: "",
                shop: "",
                jobs: [],
                saving: false,
            },
            todayLoadModal: {
                open: false,
                wizardId: null,
                dmName: "",
                loadDate: "",
                summaryHtml: "",
                stockSummaryHtml: "",
                shopCount: 0,
                stillToPick: 0,
                vanQty: 0,
                warehouseQty: 0,
                pickLines: [],
                shopLines: [],
                saving: false,
            },
            vanTransferModal: {
                open: false,
                wizardId: null,
                dmName: "",
                procedureHtml: "",
                vanQty: 0,
                warehouseQty: 0,
                openPickedJobs: 0,
                lines: [],
                saving: false,
            },

            loading: {
                fetch: false,
                save: false,
                toggle: false,
                coverage: false,
                wallet: false,
            },
            confirmModal: {
                isOpen: false,
                title: "",
                message: "",
                onConfirm: null,
            },
            formData: {
                name: "",
                employee_code: "",
                email: "",
                password: "",
                role: initialRole,
            },
            collectModal: {
                open: false,
                shopId: "",
                shopSearch: "",
                shops: [],
                wizardId: null,
                walletBalance: 0,
                shopOutstanding: 0,
                lines: [],
                notes: "",
                paymentMethod: "cash",
                chequeNumber: "",
                chequeImage: false,
            },
            settleModal: {
                open: false,
                wizardId: null,
                walletBalance: 0,
                amount: 0,
                bankJournalId: "",
                journals: [],
                notes: "",
            },
            itemsPerPage: ITEMS_PER_PAGE,
            searchTimeout: null,
            tableStaff: [],
            archivedStaffTable: [],
            pagination: {
                staff: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                archive: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                detailJobs: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                detailDispatch: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
            },
            filters: {
                staff: { search: "", status: "all" },
                archive: { search: "" },
            },
        });

        this.pollingInterval = null;

        this.debounceSearch = (func, wait) => {
            return (...args) => {
                clearTimeout(this.state.searchTimeout);
                this.state.searchTimeout = setTimeout(() => func.apply(this, args), wait);
            };
        };
        this.debouncedFetchStaffData = this.debounceSearch(() => this.fetchStaffData(), 400);

        onWillStart(async () => {
            if (this.props.requestedShowCreate) {
                this.state.activeTab = "delivery_man";
                this.openForm();
            }
            await this.fetchStaffData();
        });

        onWillUpdateProps((nextProps) => {
            if (this.props.requestedShowCreate && !nextProps.requestedShowCreate && this.state.showForm && !this.state.editingStaffId) {
                this.cancelForm();
            }
            const role = nextProps.requestedStaffRole;
            if (nextProps.requestedShowCreate && !this.props.requestedShowCreate) {
                this.state.activeTab = "delivery_man";
                this.openForm();
                return;
            }
            if (role && role !== this.state.activeTab && this.state.viewMode === "list" && !this.state.showForm) {
                this.switchTab(role);
            }
        });

        onMounted(() => {
            this.pollingInterval = setInterval(() => {
                if (!this.state.loading.save && !this.state.loading.toggle && !this.state.showForm && this.state.viewMode !== "detail") {
                    this.fetchStaffData(true);
                }
            }, 15000);
        });

        onWillUnmount(() => {
            if (this.pollingInterval) clearInterval(this.pollingInterval);
        });
    }

    get hasFinancialAccess() {
        return hasFinancialAccess();
    }

    get isDeliveryManTab() {
        return this.state.activeTab === "delivery_man";
    }

    onSearchInput(ev, tabName) {
        this.state.filters[tabName].search = ev.target.value;
        this.state.pagination[tabName].page = 1;
        this.debouncedFetchStaffData();
    }

    onFilterChange(tabName) {
        this.state.pagination[tabName].page = 1;
        this.fetchStaffData();
    }

    changePage(tabName, direction) {
        const pag = this.state.pagination[tabName];
        const newPage = pag.page + direction;
        const maxPage = Math.max(1, Math.ceil(pag.total / pag.limit));
        if (newPage >= 1 && newPage <= maxPage) {
            pag.page = newPage;
            if (tabName === "detailJobs") {
                this.fetchDetailJobs();
            } else if (tabName === "detailDispatch") {
                this.fetchDetailDispatch();
            } else {
                this.fetchStaffData();
            }
        }
    }

    _roleDomain() {
        if (this.isDeliveryManTab) {
            return [["shahtaj_is_delivery_man", "=", true]];
        }
        return [["shahtaj_is_order_booker", "=", true]];
    }

    _listFields() {
        const fields = [
            "id", "name", "shahtaj_employee_code", "shahtaj_online_status",
            "shahtaj_last_seen_at", "active", "login",
        ];
        if (this.isDeliveryManTab) {
            fields.push(
                "shahtaj_dm_jobs_today_count",
                "shahtaj_pending_delivery_count",
                "shahtaj_van_qty_on_hand",
                "shahtaj_dm_wallet_balance",
                "shahtaj_dm_job_count",
                "shahtaj_van_sku_count",
                "shahtaj_dm_on_van_for_shops",
                "shahtaj_dm_picked_today",
                "shahtaj_dm_delivered_today",
            );
        } else {
            fields.push(
                "shahtaj_task_today_total",
                "shahtaj_task_today_pending",
                "shahtaj_task_today_done",
                "shahtaj_active_target_progress",
                "shahtaj_active_target_summary",
            );
        }
        return fields;
    }

    _mapStaffRow(u) {
        const role = this.isDeliveryManTab ? "Delivery Man" : "Order Booker";
        return {
            id: u.id,
            name: u.name,
            login: u.login,
            employee_code: u.shahtaj_employee_code,
            role,
            roleKey: this.state.activeTab,
            status: u.shahtaj_online_status,
            active: u.active,
            last_seen_at: u.shahtaj_last_seen_at || false,
            last_seen_label: this.formatLastSeen(u.shahtaj_last_seen_at),
            jobsToday: u.shahtaj_dm_jobs_today_count || 0,
            openJobs: u.shahtaj_pending_delivery_count || 0,
            jobCount: u.shahtaj_dm_job_count || 0,
            vanQty: u.shahtaj_van_qty_on_hand || 0,
            skuCount: u.shahtaj_van_sku_count || 0,
            loadedForShops: u.shahtaj_dm_on_van_for_shops || 0,
            pickedToday: u.shahtaj_dm_picked_today || 0,
            deliveredToday: u.shahtaj_dm_delivered_today || 0,
            wallet: u.shahtaj_dm_wallet_balance || 0,
            metrics: {
                today: {
                    total: u.shahtaj_task_today_total || 0,
                    pending: u.shahtaj_task_today_pending || 0,
                    completed: u.shahtaj_task_today_done || 0,
                },
                activeTarget: {
                    summary: u.shahtaj_active_target_summary,
                    progress: u.shahtaj_active_target_progress,
                },
            },
        };
    }

    async fetchStaffData(isBackgroundPoll = false) {
        if (!isBackgroundPoll) {
            this.state.loading.fetch = true;
            notifyPortalBusy(true);
        }
        try {
            const tab = this.state.viewMode === "archive" ? "archive" : "staff";
            const pag = this.state.pagination[tab];
            const filters = this.state.filters[tab];
            const domain = this._roleDomain();

            if (tab === "archive") {
                domain.push(["active", "=", false]);
            } else {
                domain.push(["active", "=", true]);
                if (filters.status === "online") domain.push(["shahtaj_online_status", "=", "online"]);
            }

            if (filters.search) {
                domain.push("|", ["name", "ilike", filters.search], ["shahtaj_employee_code", "ilike", filters.search]);
            }

            const queryKwargs = {
                limit: pag.limit,
                offset: (pag.page - 1) * pag.limit,
                order: "name asc",
            };
            if (tab === "archive") {
                queryKwargs.context = { active_test: false };
            }
            const [total, users] = await Promise.all([
                this.orm.searchCount("res.users", domain, tab === "archive" ? { context: { active_test: false } } : {}),
                this.orm.searchRead(
                    "res.users",
                    domain,
                    this._listFields(),
                    queryKwargs,
                ),
            ]);

            this.state.pagination[tab].total = total;
            const mapped = users.map((u) => this._mapStaffRow(u));
            if (tab === "archive") this.state.archivedStaffTable = mapped;
            else this.state.tableStaff = mapped;
        } catch (error) {
            if (!isBackgroundPoll) {
                this.notification.add("Failed to fetch data: " + (error.data?.message || error.message), { type: "danger" });
            }
        } finally {
            if (!isBackgroundPoll) {
                this.state.loading.fetch = false;
                notifyPortalBusy(false);
            }
        }
    }

    showConfirm(title, message, onConfirmCallback) {
        this.state.confirmModal = {
            isOpen: true,
            title,
            message,
            onConfirm: async () => {
                this.state.confirmModal.isOpen = false;
                await onConfirmCallback();
            },
        };
    }

    closeConfirm() {
        this.state.confirmModal.isOpen = false;
    }

    openArchive() {
        this.state.viewMode = "archive";
        this.state.pagination.archive.page = 1;
        this.fetchStaffData();
    }

    formatLastSeen(value) {
        if (!value) {
            return "Never seen";
        }
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) {
            return String(value);
        }
        return date.toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    }

    formatMoney(value) {
        const amount = Number(value) || 0;
        return amount.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    async openDetails(staff) {
        this.state.selectedStaff = staff;
        this.state.viewMode = "detail";
        if (staff.roleKey === "delivery_man" || this.isDeliveryManTab) {
            this.state.detailTab = "jobs";
            this.state.pagination.detailJobs.page = 1;
            this.state.pagination.detailDispatch.page = 1;
            await Promise.all([
                this.fetchDetailJobs(),
                this.fetchDetailDispatch(),
                this.fetchVanSnapshot(staff.id),
                this.fetchCoverage(staff.id),
                this._ensureLookupDeliveryMen(),
            ]);
            return;
        }

        const schedules = await this.orm.searchRead(
            "shahtaj.weekly.schedule",
            [["order_booker_id", "=", staff.id]],
            ["id", "day_of_week", "route_id", "zone_id", "active"],
            {
                context: { active_test: false },
                order: "day_of_week asc, active desc, id asc",
            },
        );
        const dayMap = {
            0: "Monday", 1: "Tuesday", 2: "Wednesday",
            3: "Thursday", 4: "Friday", 5: "Saturday", 6: "Sunday",
        };
        this.state.detailSchedules = schedules.map((s) => ({
            ...s,
            day: dayMap[s.day_of_week] || s.day_of_week,
        }));
        this.state.detailTargets = await this.orm.searchRead(
            "shahtaj.visit.target",
            [["order_booker_id", "=", staff.id]],
            ["id", "date_start", "date_end", "target_type", "target_value", "achieved_value", "progress_percent", "active"],
            {
                context: { active_test: false },
                order: "date_start desc, active desc, id desc",
            },
        );
        this.state.detailTab = "schedules";
    }

    async fetchDetailJobs() {
        const staff = this.state.selectedStaff;
        if (!staff) return;
        const pag = this.state.pagination.detailJobs;
        const domain = [["delivery_man_id", "=", staff.id]];
        const [total, jobs] = await Promise.all([
            this.orm.searchCount("shahtaj.dm.delivery", domain),
            this.orm.searchRead(
                "shahtaj.dm.delivery",
                domain,
                ["id", "display_name", "partner_id", "sale_order_id", "order_booker_id", "order_date",
                 "scheduled_date", "state", "field_state", "assignment_mode", "amount_total", "qty_assigned_total"],
                { limit: pag.limit, offset: (pag.page - 1) * pag.limit, order: "scheduled_date desc, id desc" },
            ),
        ]);
        this.state.pagination.detailJobs.total = total;
        this.state.detailJobs = jobs.map((j) => ({
            id: j.id,
            name: j.display_name || (j.sale_order_id ? j.sale_order_id[1] : `Job ${j.id}`),
            shop: j.partner_id ? j.partner_id[1] : "—",
            order: j.sale_order_id ? j.sale_order_id[1] : "—",
            booker: j.order_booker_id ? j.order_booker_id[1] : "—",
            orderDate: j.order_date || "—",
            date: j.scheduled_date || "—",
            amount: j.amount_total || 0,
            qtyAssigned: j.qty_assigned_total || 0,
            assignmentMode: j.assignment_mode,
            state: j.state,
            fieldState: j.field_state,
        }));
    }

    async fetchVanSnapshot(userId) {
        const [rec] = await this.orm.read(
            "res.users",
            [userId],
            [
                "shahtaj_van_qty_on_hand",
                "shahtaj_van_sku_count",
                "shahtaj_dm_on_van_for_shops",
                "shahtaj_dm_picked_today",
                "shahtaj_dm_delivered_today",
                "shahtaj_dm_wallet_balance",
                "shahtaj_dm_jobs_today_count",
                "shahtaj_pending_delivery_count",
                "shahtaj_van_stock_html",
                "shahtaj_dm_recent_activity_html",
            ],
        );
        if (!rec) return;
        this.state.vanSnapshot = {
            qtyOnHand: rec.shahtaj_van_qty_on_hand || 0,
            skuCount: rec.shahtaj_van_sku_count || 0,
            onVanForShops: rec.shahtaj_dm_on_van_for_shops || 0,
            pickedToday: rec.shahtaj_dm_picked_today || 0,
            deliveredToday: rec.shahtaj_dm_delivered_today || 0,
        };
        this.state.vanStockHtml = rec.shahtaj_van_stock_html || "";
        this.state.recentActivityHtml = rec.shahtaj_dm_recent_activity_html || "";
        if (this.state.selectedStaff) {
            this.state.selectedStaff.wallet = rec.shahtaj_dm_wallet_balance || 0;
            this.state.selectedStaff.jobsToday = rec.shahtaj_dm_jobs_today_count || 0;
            this.state.selectedStaff.openJobs = rec.shahtaj_pending_delivery_count || 0;
            this.state.selectedStaff.vanQty = rec.shahtaj_van_qty_on_hand || 0;
        }
    }

    async fetchCoverage(userId) {
        const [rec] = await this.orm.read("res.users", [userId], ["shahtaj_assigned_booker_ids"]);
        this.state.coverageBookerIds = rec?.shahtaj_assigned_booker_ids || [];
        if (!this.state.lookupBookers.length) {
            this.state.lookupBookers = await this.orm.searchRead(
                "res.users",
                [["shahtaj_is_order_booker", "=", true], ["active", "=", true]],
                ["id", "name"],
                { order: "name asc", limit: 200 },
            );
        }
    }

    isBookerCovered(bookerId) {
        return this.state.coverageBookerIds.includes(bookerId);
    }

    async toggleCoverage(bookerId) {
        if (!this.state.selectedStaff) return;
        const current = new Set(this.state.coverageBookerIds);
        if (current.has(bookerId)) current.delete(bookerId);
        else current.add(bookerId);
        const ids = [...current];
        this.state.loading.coverage = true;
        try {
            await this.orm.write("res.users", [this.state.selectedStaff.id], {
                shahtaj_assigned_booker_ids: [[6, 0, ids]],
            });
            this.state.coverageBookerIds = ids;
        } catch (error) {
            this.notification.add("Failed to update coverage: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.loading.coverage = false;
        }
    }

    switchTab(tabName) {
        this.state.activeTab = tabName;
        this.state.viewMode = "list";
        this.state.showForm = false;
        this.state.pagination.staff.page = 1;
        this.state.formData.role = tabName;
        this.fetchStaffData();
    }

    goBack() {
        this.state.selectedStaff = null;
        this.state.viewMode = "list";
        this.fetchStaffData();
    }

    openForm() {
        this.state.formData = {
            name: "",
            employee_code: "",
            email: "",
            password: "",
            role: this.state.activeTab,
        };
        this.state.editingStaffId = null;
        this.state.showForm = true;
    }

    cancelForm() {
        this.state.showForm = false;
        this.state.showPassword = false;
        this.state.editingStaffId = null;
        this.state.formData = {
            name: "",
            employee_code: "",
            email: "",
            password: "",
            role: this.state.activeTab,
        };
    }

    editStaff(staff) {
        this.state.formData = {
            name: staff.name,
            employee_code: staff.employee_code || "",
            email: staff.login || "",
            password: "",
            role: staff.roleKey || this.state.activeTab,
        };
        this.state.editingStaffId = staff.id;
        this.state.showForm = true;
    }

    async saveStaff() {
        this.state.loading.save = true;
        try {
            const role = this.state.formData.role || this.state.activeTab;
            if (this.state.editingStaffId) {
                const payload = {
                    name: this.state.formData.name,
                    login: this.state.formData.email,
                    shahtaj_employee_code: this.state.formData.employee_code,
                };
                if (this.state.formData.password) {
                    payload.password = this.state.formData.password;
                }
                await this.orm.write("res.users", [this.state.editingStaffId], payload);
            } else if (role === "delivery_man") {
                const wizardIds = await this.orm.create("shahtaj.create.delivery.man.wizard", [{
                    name: this.state.formData.name,
                    login: this.state.formData.email,
                    password: this.state.formData.password,
                    shahtaj_employee_code: this.state.formData.employee_code,
                }]);
                await this.orm.call("shahtaj.create.delivery.man.wizard", "action_create_delivery_man", [wizardIds]);
            } else {
                const wizardIds = await this.orm.create("shahtaj.create.order.booker.wizard", [{
                    name: this.state.formData.name,
                    login: this.state.formData.email,
                    password: this.state.formData.password,
                    shahtaj_employee_code: this.state.formData.employee_code,
                }]);
                await this.orm.call("shahtaj.create.order.booker.wizard", "action_create_booker", [wizardIds]);
            }
            this.cancelForm();
            await this.fetchStaffData();
        } catch (error) {
            console.error("Save failed:", error);
            const errorMessage = error.data?.message || error.message || "Unknown error occurred";
            this.notification.add(`Failed to save staff:\n\n${errorMessage}`, { type: "danger" });
        } finally {
            this.state.loading.save = false;
        }
    }

    toggleActiveStatus(staffId, currentStatus) {
        const newStatus = !currentStatus;
        const actionTitle = newStatus ? "Restore Account" : "Deactivate & Archive Account";
        const actionMessage = newStatus
            ? "Are you sure you want to restore this user? They will regain access to the mobile application."
            : "Are you sure you want to deactivate this user? They will be moved to the archive and immediately lose access to the system.";
        this.showConfirm(actionTitle, actionMessage, () => this.executeToggleStatus(staffId, newStatus));
    }

    async executeToggleStatus(staffId, newStatus) {
        this.state.loading.toggle = true;
        try {
            const isDm = this.isDeliveryManTab || this.state.selectedStaff?.roleKey === "delivery_man";
            const methodName = isDm
                ? (newStatus ? "action_shahtaj_activate_delivery_man" : "action_shahtaj_deactivate_delivery_man")
                : (newStatus ? "action_shahtaj_activate_booker" : "action_shahtaj_deactivate_booker");
            await this.orm.call("res.users", methodName, [[staffId]]);
            await this.fetchStaffData();
            if (this.state.selectedStaff && this.state.selectedStaff.id === staffId) {
                this.state.selectedStaff.active = newStatus;
            }
        } catch (error) {
            console.error("Failed to toggle status:", error);
            this.notification.add("An error occurred while updating the status.", { type: "danger" });
        } finally {
            this.state.loading.toggle = false;
        }
    }

    async openCollectModal() {
        if (!this.state.selectedStaff) return;
        this.state.collectModal = {
            open: true,
            shopId: "",
            shopSearch: "",
            shops: [],
            wizardId: null,
            walletBalance: this.state.selectedStaff.wallet || 0,
            shopOutstanding: 0,
            lines: [],
            notes: "",
            paymentMethod: "cash",
            chequeNumber: "",
            chequeImage: false,
        };
        await this.searchCollectShops("");
    }

    closeCollectModal() {
        this.state.collectModal.open = false;
        this.state.collectModal.wizardId = null;
        this.state.collectModal.lines = [];
    }

    async searchCollectShops(query) {
        const domain = [
            ["is_shahtaj_shop", "=", true],
            ["shop_approval_state", "=", "approved"],
            ["active", "=", true],
        ];
        if (query) domain.push(["name", "ilike", query]);
        this.state.collectModal.shops = await this.orm.searchRead(
            "res.partner",
            domain,
            ["id", "name"],
            { limit: 30, order: "name asc" },
        );
    }

    onCollectShopSearch(ev) {
        this.state.collectModal.shopSearch = ev.target.value;
        clearTimeout(this.state.searchTimeout);
        this.state.searchTimeout = setTimeout(() => this.searchCollectShops(ev.target.value), 400);
    }

    async onCollectShopChange() {
        const shopId = parseInt(this.state.collectModal.shopId, 10);
        if (!shopId || !this.state.selectedStaff) {
            this.state.collectModal.lines = [];
            this.state.collectModal.wizardId = null;
            return;
        }
        this.state.loading.wallet = true;
        try {
            const wizardIds = await this.orm.create(
                "shahtaj.dm.collect.payment",
                [{}],
                { context: { default_delivery_man_id: this.state.selectedStaff.id, default_partner_id: shopId } },
            );
            const wizardId = Array.isArray(wizardIds) ? wizardIds[0] : wizardIds;
            const [wiz] = await this.orm.read(
                "shahtaj.dm.collect.payment",
                [wizardId],
                ["wallet_balance", "shop_outstanding", "line_ids", "notes"],
            );
            const lines = wiz.line_ids?.length
                ? await this.orm.read(
                    "shahtaj.dm.collect.payment.line",
                    wiz.line_ids,
                    ["id", "move_id", "amount_residual", "amount"],
                )
                : [];
            this.state.collectModal.wizardId = wizardId;
            this.state.collectModal.walletBalance = wiz.wallet_balance || 0;
            this.state.collectModal.shopOutstanding = wiz.shop_outstanding || 0;
            this.state.collectModal.lines = lines.map((l) => ({
                id: l.id,
                move: l.move_id ? l.move_id[1] : "Invoice",
                residual: l.amount_residual || 0,
                amount: l.amount || 0,
            }));
        } catch (error) {
            this.notification.add("Failed to load invoices: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.loading.wallet = false;
        }
    }

    async fillCollectResiduals() {
        if (!this.state.collectModal.wizardId) return;
        this.state.loading.wallet = true;
        try {
            await this.orm.call("shahtaj.dm.collect.payment", "action_fill_full_residuals", [[this.state.collectModal.wizardId]]);
            const lines = this.state.collectModal.lines;
            if (lines.length) {
                const refreshed = await this.orm.read(
                    "shahtaj.dm.collect.payment.line",
                    lines.map((l) => l.id),
                    ["id", "move_id", "amount_residual", "amount"],
                );
                this.state.collectModal.lines = refreshed.map((l) => ({
                    id: l.id,
                    move: l.move_id ? l.move_id[1] : "Invoice",
                    residual: l.amount_residual || 0,
                    amount: l.amount || 0,
                }));
            }
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
        } finally {
            this.state.loading.wallet = false;
        }
    }

    async confirmCollect() {
        if (!this.state.collectModal.wizardId) return;
        this.state.loading.wallet = true;
        try {
            for (const line of this.state.collectModal.lines) {
                await this.orm.write("shahtaj.dm.collect.payment.line", [line.id], { amount: Number(line.amount) || 0 });
            }
            await this.orm.write("shahtaj.dm.collect.payment", [this.state.collectModal.wizardId], {
                notes: this.state.collectModal.notes || "",
                payment_method: this.state.collectModal.paymentMethod || "cash",
                cheque_number: this.state.collectModal.chequeNumber || false,
                ...(this.state.collectModal.chequeImage ? { cheque_image: this.state.collectModal.chequeImage } : {}),
            });
            await this.orm.call("shahtaj.dm.collect.payment", "action_confirm", [[this.state.collectModal.wizardId]]);
            this.notification.add("Collected into DM wallet.", { type: "success" });
            this.closeCollectModal();
            await this.fetchVanSnapshot(this.state.selectedStaff.id);
        } catch (error) {
            this.notification.add("Collection failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.loading.wallet = false;
        }
    }

    async openSettleModal() {
        if (!this.state.selectedStaff) return;
        this.state.loading.wallet = true;
        try {
            const wizardIds = await this.orm.create(
                "shahtaj.dm.wallet.settle",
                [{}],
                { context: { default_delivery_man_id: this.state.selectedStaff.id, active_model: "res.users", active_id: this.state.selectedStaff.id } },
            );
            const wizardId = Array.isArray(wizardIds) ? wizardIds[0] : wizardIds;
            const [wiz] = await this.orm.read(
                "shahtaj.dm.wallet.settle",
                [wizardId],
                ["wallet_balance", "amount", "bank_journal_id", "notes"],
            );
            const journals = await this.orm.searchRead(
                "account.journal",
                [["type", "in", ["bank", "cash"]], ["code", "!=", "DMCASH"]],
                ["id", "name"],
                { limit: 40, order: "name asc" },
            );
            this.state.settleModal = {
                open: true,
                wizardId,
                walletBalance: wiz.wallet_balance || 0,
                amount: wiz.amount || 0,
                bankJournalId: wiz.bank_journal_id ? String(wiz.bank_journal_id[0]) : "",
                journals,
                notes: wiz.notes || "",
            };
        } catch (error) {
            this.notification.add("Failed to open settle: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.loading.wallet = false;
        }
    }

    closeSettleModal() {
        this.state.settleModal.open = false;
        this.state.settleModal.wizardId = null;
    }

    async confirmSettle() {
        if (!this.state.settleModal.wizardId) return;
        this.state.loading.wallet = true;
        try {
            await this.orm.write("shahtaj.dm.wallet.settle", [this.state.settleModal.wizardId], {
                amount: Number(this.state.settleModal.amount) || 0,
                bank_journal_id: parseInt(this.state.settleModal.bankJournalId, 10),
                notes: this.state.settleModal.notes || "",
            });
            await this.orm.call("shahtaj.dm.wallet.settle", "action_confirm", [[this.state.settleModal.wizardId]]);
            this.notification.add("Wallet settled to bank.", { type: "success" });
            this.closeSettleModal();
            await this.fetchVanSnapshot(this.state.selectedStaff.id);
        } catch (error) {
            this.notification.add("Settle failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.loading.wallet = false;
        }
    }

    assignmentModeLabel(mode) {
        const map = { auto: "Auto (booker)", manual: "Manual" };
        return map[mode] || mode || "—";
    }

    deliveryStatusLabel(status) {
        const map = { pending: "Pending", partial: "Partial", done: "Done", no_stock: "No stock" };
        return map[status] || status || "—";
    }

    deliveryStatusBadgeClass(status) {
        if (status === "done") return "bg-success text-white";
        if (status === "partial") return "bg-info text-white";
        if (status === "pending") return "bg-warning text-dark";
        return "bg-light text-dark";
    }

    _m2oName(value) {
        if (!value) return "—";
        return Array.isArray(value) ? (value[1] || "—") : String(value);
    }

    _safeMarkup(html) {
        return html ? String(html) : "";
    }

    htmlOut(html) {
        if (!html) return "";
        return markup(String(html));
    }

    _dmWizardContext(dmId) {
        return { shahtaj_delivery_man_id: dmId };
    }

    async _ensureLookupDeliveryMen() {
        if (this.state.lookupDeliveryMen.length) return;
        this.state.lookupDeliveryMen = await this.orm.searchRead(
            "res.users",
            [["shahtaj_is_delivery_man", "=", true], ["active", "=", true]],
            ["id", "name"],
            { order: "name asc", limit: 300 },
        );
    }

    async fetchDetailDispatch() {
        const staff = this.state.selectedStaff;
        if (!staff) return;
        try {
        const pag = this.state.pagination.detailDispatch;
        const [user] = await this.orm.read("res.users", [staff.id], ["shahtaj_dm_dispatchable_order_ids"]);
        const ids = user?.shahtaj_dm_dispatchable_order_ids || [];
        this.state.pagination.detailDispatch.total = ids.length;
        if (!ids.length) {
            this.state.detailDispatch = [];
            return;
        }
        const pageIds = ids.slice((pag.page - 1) * pag.limit, pag.page * pag.limit);
        const orders = await this.orm.read(
            "sale.order",
            pageIds,
            ["id", "name", "partner_id", "user_id", "date_order", "amount_total", "shahtaj_delivery_status", "invoice_ids"],
        );
        const posted = new Set();
        const invoiceIds = orders.flatMap((o) => o.invoice_ids || []);
        if (invoiceIds.length) {
            const invoices = await this.orm.searchRead(
                "account.move",
                [["id", "in", invoiceIds], ["state", "=", "posted"]],
                ["id", "invoice_origin"],
            );
            for (const inv of invoices) posted.add(inv.id);
        }
        this.state.detailDispatch = orders.map((o) => ({
            odoo_id: o.id,
            id: o.name,
            shop: o.partner_id ? o.partner_id[1] : "—",
            booker: o.user_id ? o.user_id[1] : "—",
            date: o.date_order ? String(o.date_order).split(" ")[0] : "—",
            amount: o.amount_total || 0,
            deliveryStatus: o.shahtaj_delivery_status || "",
            hasPostedInvoice: (o.invoice_ids || []).some((iid) => posted.has(iid)),
        }));
        } catch (error) {
            this.notification.add("Failed to load dispatch orders: " + (error.data?.message || error.message), { type: "danger" });
            this.state.detailDispatch = [];
        }
    }

    canAssignDispatch(row) {
        return row && row.hasPostedInvoice;
    }

    async openAssignModal(orderId) {
        const row = this.state.detailDispatch.find((r) => r.odoo_id === orderId);
        if (row && !this.canAssignDispatch(row)) {
            this.notification.add("Invoice and post this order before assigning a delivery man.", { type: "warning" });
            return;
        }
        this.state.assignModal.saving = true;
        try {
            await this._ensureLookupDeliveryMen();
            const wizardIds = await this.orm.create(
                "shahtaj.dm.assign.wizard",
                [{}],
                { context: { active_id: orderId, active_model: "sale.order" } },
            );
            const wizardId = Array.isArray(wizardIds) ? wizardIds[0] : wizardIds;
            await this._loadAssignWizard(wizardId);
            this.state.assignModal.open = true;
        } catch (error) {
            this.notification.add("Failed to open assign: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.assignModal.saving = false;
        }
    }

    async _loadAssignWizard(wizardId) {
        const [wiz] = await this.orm.read("shahtaj.dm.assign.wizard", [wizardId], ["sale_order_id", "partner_id", "job_ids"]);
        const jobs = wiz.job_ids?.length
            ? await this.orm.read("shahtaj.dm.assign.wizard.job", wiz.job_ids, ["id", "delivery_man_id", "scheduled_date", "line_ids"])
            : [];
        const allLineIds = jobs.flatMap((j) => j.line_ids || []);
        const lineRecs = allLineIds.length
            ? await this.orm.read("shahtaj.dm.assign.wizard.line", allLineIds, ["id", "sale_order_line_id", "product_id", "qty_ordered", "qty_assigned"])
            : [];
        const linesById = Object.fromEntries(lineRecs.map((l) => [l.id, l]));
        this.state.assignModal.wizardId = wizardId;
        this.state.assignModal.orderName = wiz.sale_order_id ? wiz.sale_order_id[1] : "";
        this.state.assignModal.shop = wiz.partner_id ? wiz.partner_id[1] : "";
        this.state.assignModal.jobs = jobs.map((j) => ({
            id: j.id,
            deliveryManId: j.delivery_man_id ? String(j.delivery_man_id[0]) : "",
            scheduledDate: j.scheduled_date || "",
            lines: (j.line_ids || []).map((lid) => {
                const l = linesById[lid] || {};
                return {
                    id: lid,
                    product: l.product_id ? l.product_id[1] : "Product",
                    qtyOrdered: l.qty_ordered || 0,
                    qtyAssigned: l.qty_assigned || 0,
                };
            }),
        }));
    }

    closeAssignModal() {
        this.state.assignModal.open = false;
        this.state.assignModal.wizardId = null;
        this.state.assignModal.jobs = [];
    }

    async persistAssignEdits() {
        for (const job of this.state.assignModal.jobs) {
            await this.orm.write("shahtaj.dm.assign.wizard.job", [job.id], {
                delivery_man_id: job.deliveryManId ? parseInt(job.deliveryManId, 10) : false,
                scheduled_date: job.scheduledDate || false,
            });
            for (const line of job.lines) {
                await this.orm.write("shahtaj.dm.assign.wizard.line", [line.id], {
                    qty_assigned: Number(line.qtyAssigned) || 0,
                });
            }
        }
    }

    async addAssignDeliveryMan() {
        if (!this.state.assignModal.wizardId) return;
        this.state.assignModal.saving = true;
        try {
            await this.persistAssignEdits();
            await this.orm.call("shahtaj.dm.assign.wizard", "action_add_delivery_man", [[this.state.assignModal.wizardId]]);
            await this._loadAssignWizard(this.state.assignModal.wizardId);
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
        } finally {
            this.state.assignModal.saving = false;
        }
    }

    async confirmAssign() {
        if (!this.state.assignModal.wizardId) return;
        this.state.assignModal.saving = true;
        try {
            await this.persistAssignEdits();
            await this.orm.call("shahtaj.dm.assign.wizard", "action_confirm_assign", [[this.state.assignModal.wizardId]]);
            this.notification.add("Delivery men assigned.", { type: "success" });
            this.closeAssignModal();
            await Promise.all([this.fetchDetailJobs(), this.fetchDetailDispatch(), this.fetchVanSnapshot(this.state.selectedStaff.id)]);
        } catch (error) {
            this.notification.add("Assign failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.assignModal.saving = false;
        }
    }

    async openTodayLoad(dmId) {
        const id = dmId || this.state.selectedStaff?.id;
        if (!id) return;
        this.state.todayLoadModal.saving = true;
        try {
            const action = await this.orm.call("shahtaj.dm.today.load", "action_open", [], { context: this._dmWizardContext(id) });
            await this._loadTodayLoadWizard(action.res_id);
            this.state.todayLoadModal.open = true;
        } catch (error) {
            this.notification.add("Today Load failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.todayLoadModal.saving = false;
        }
    }

    async _loadTodayLoadWizard(wizardId) {
        const [wiz] = await this.orm.read("shahtaj.dm.today.load", [wizardId], [
            "delivery_man_id", "load_date", "summary_html", "stock_summary_html",
            "shop_count", "total_still_to_pick", "van_qty_on_hand", "warehouse_qty_available",
            "pick_line_ids", "shop_line_ids",
        ]);
        const pickLines = wiz.pick_line_ids?.length
            ? await this.orm.read("shahtaj.dm.today.load.pick", wiz.pick_line_ids, [
                "id", "product_id", "product_uom_id", "qty_warehouse_available", "qty_on_van", "qty_still_needed", "qty_to_pick",
            ])
            : [];
        const shopLines = wiz.shop_line_ids?.length
            ? await this.orm.read("shahtaj.dm.today.load.shop", wiz.shop_line_ids, [
                "id", "partner_id", "sale_order_id", "state", "field_state",
            ])
            : [];
        this.state.todayLoadModal.wizardId = wizardId;
        this.state.todayLoadModal.dmName = this._m2oName(wiz.delivery_man_id);
        this.state.todayLoadModal.loadDate = wiz.load_date || "";
        this.state.todayLoadModal.summaryHtml = this._safeMarkup(wiz.summary_html);
        this.state.todayLoadModal.stockSummaryHtml = this._safeMarkup(wiz.stock_summary_html);
        this.state.todayLoadModal.shopCount = wiz.shop_count || 0;
        this.state.todayLoadModal.stillToPick = wiz.total_still_to_pick || 0;
        this.state.todayLoadModal.vanQty = wiz.van_qty_on_hand || 0;
        this.state.todayLoadModal.warehouseQty = wiz.warehouse_qty_available || 0;
        this.state.todayLoadModal.pickLines = pickLines.map((l) => ({
            id: l.id,
            product: this._m2oName(l.product_id),
            uom: this._m2oName(l.product_uom_id),
            warehouse: l.qty_warehouse_available || 0,
            onVan: l.qty_on_van || 0,
            stillNeed: l.qty_still_needed || 0,
            qtyToPick: l.qty_to_pick || 0,
        }));
        this.state.todayLoadModal.shopLines = shopLines.map((l) => ({
            id: l.id,
            shop: this._m2oName(l.partner_id),
            order: this._m2oName(l.sale_order_id),
            state: l.state,
            fieldState: l.field_state,
        }));
    }

    closeTodayLoadModal() {
        this.state.todayLoadModal.open = false;
        this.state.todayLoadModal.wizardId = null;
        this.state.todayLoadModal.pickLines = [];
        this.state.todayLoadModal.shopLines = [];
    }

    async confirmTodayLoad() {
        if (!this.state.todayLoadModal.wizardId) return;
        this.state.todayLoadModal.saving = true;
        try {
            for (const line of this.state.todayLoadModal.pickLines) {
                await this.orm.write("shahtaj.dm.today.load.pick", [line.id], { qty_to_pick: Number(line.qtyToPick) || 0 });
            }
            await this.orm.call("shahtaj.dm.today.load", "action_pick_today_load", [[this.state.todayLoadModal.wizardId]]);
            this.notification.add("Today's load picked to van.", { type: "success" });
            this.closeTodayLoadModal();
            await Promise.all([this.fetchDetailJobs(), this.fetchVanSnapshot(this.state.selectedStaff.id)]);
        } catch (error) {
            this.notification.add("Today Load failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.todayLoadModal.saving = false;
        }
    }

    async openVanTransfer(dmId) {
        const id = dmId || this.state.selectedStaff?.id;
        if (!id) return;
        this.state.vanTransferModal.saving = true;
        try {
            const action = await this.orm.call("shahtaj.dm.van.transfer", "action_open", [], { context: this._dmWizardContext(id) });
            await this._loadVanTransferWizard(action.res_id);
            this.state.vanTransferModal.open = true;
        } catch (error) {
            this.notification.add("Van procedure failed: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.vanTransferModal.saving = false;
        }
    }

    async _loadVanTransferWizard(wizardId) {
        const [wiz] = await this.orm.read("shahtaj.dm.van.transfer", [wizardId], [
            "delivery_man_id", "procedure_html", "van_qty_total", "warehouse_qty_total", "open_picked_job_count", "line_ids",
        ]);
        const lines = wiz.line_ids?.length
            ? await this.orm.read("shahtaj.dm.van.transfer.line", wiz.line_ids, [
                "id", "product_id", "product_uom_id", "qty_warehouse", "qty_on_van", "qty_load", "qty_return",
            ])
            : [];
        this.state.vanTransferModal.wizardId = wizardId;
        this.state.vanTransferModal.dmName = this._m2oName(wiz.delivery_man_id);
        this.state.vanTransferModal.procedureHtml = this._safeMarkup(wiz.procedure_html);
        this.state.vanTransferModal.vanQty = wiz.van_qty_total || 0;
        this.state.vanTransferModal.warehouseQty = wiz.warehouse_qty_total || 0;
        this.state.vanTransferModal.openPickedJobs = wiz.open_picked_job_count || 0;
        this.state.vanTransferModal.lines = lines.map((l) => ({
            id: l.id,
            product: this._m2oName(l.product_id),
            uom: this._m2oName(l.product_uom_id),
            warehouse: l.qty_warehouse || 0,
            onVan: l.qty_on_van || 0,
            qtyLoad: l.qty_load || 0,
            qtyReturn: l.qty_return || 0,
        }));
    }

    closeVanTransferModal() {
        this.state.vanTransferModal.open = false;
        this.state.vanTransferModal.wizardId = null;
        this.state.vanTransferModal.lines = [];
    }

    async _runVanTransferAction(method, successMessage) {
        if (!this.state.vanTransferModal.wizardId) return;
        this.state.vanTransferModal.saving = true;
        try {
            for (const line of this.state.vanTransferModal.lines) {
                await this.orm.write("shahtaj.dm.van.transfer.line", [line.id], {
                    qty_load: Number(line.qtyLoad) || 0,
                    qty_return: Number(line.qtyReturn) || 0,
                });
            }
            await this.orm.call("shahtaj.dm.van.transfer", method, [[this.state.vanTransferModal.wizardId]]);
            this.notification.add(successMessage, { type: "success" });
            await this._loadVanTransferWizard(this.state.vanTransferModal.wizardId);
            await this.fetchVanSnapshot(this.state.selectedStaff.id);
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
        } finally {
            this.state.vanTransferModal.saving = false;
        }
    }

    confirmVanLoad() {
        return this._runVanTransferAction("action_load_to_van", "Warehouse stock loaded onto van.");
    }

    confirmVanReturn() {
        return this._runVanTransferAction("action_return_to_warehouse", "Van stock returned to warehouse.");
    }

    confirmVanEmpty() {
        return this._runVanTransferAction("action_return_all_to_warehouse", "Van emptied to warehouse.");
    }

    onCollectChequeImage(ev) {
        const file = ev.target.files && ev.target.files[0];
        if (!file) {
            this.state.collectModal.chequeImage = false;
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            this.state.collectModal.chequeImage = result.includes(",") ? result.split(",")[1] : result;
        };
        reader.readAsDataURL(file);
    }

    stockStateLabel(state) {
        const map = {
            not_ready: "Not ready",
            ready: "Ready",
            picked: "Picked",
            partial: "Partial",
            delivered: "Delivered",
            returned: "Returned",
        };
        return map[state] || state || "—";
    }

    fieldStateLabel(state) {
        const map = {
            pending: "Pending",
            in_transit: "In transit",
            done: "Done",
            not_attended: "Shop closed",
            failed: "Failed",
        };
        return map[state] || state || "—";
    }
}

StaffManagement.template = "shahtaj_oil.StaffManagement";
