/** @odoo-module **/

import { Component, useState, onWillStart, onWillUpdateProps } from "@odoo/owl";
import { useService } from "@web/core/utils/hooks";
import { hasFinancialAccess, notifyPortalBusy } from "../shahtaj_access";

export class DeliveryManPerformance extends Component {
    static props = {
        requestedPerfSubTab: { type: String, optional: true },
        requestedOpenSettle: { type: Boolean, optional: true },
    };
    setup() {
        this.orm = useService("orm");
        this.notification = useService("notification");
        const today = new Date();
        this.todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
        const ITEMS_PER_PAGE = 10;
        const initialTab = this._allowedPerfTab(this.props.requestedPerfSubTab);
        this.state = useState({
            perfSubTab: initialTab,
            dateFrom: this.todayStr,
            dateTo: this.todayStr,
            isLoading: false,
            jobRows: [],
            selectedDm: null,
            drillJobs: [],
            sessions: [],
            collections: [],
            settlements: [],
            lookupDeliveryMen: [],
            pagination: {
                sessions: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                collections: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                settlements: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
                drill: { page: 1, limit: ITEMS_PER_PAGE, total: 0 },
            },
            filters: {
                sessions: { dm: "all", search: "" },
                collections: { dm: "all", search: "" },
                settlements: { dm: "all", search: "" },
            },
            settleDmId: "",
            settleModal: {
                open: false,
                wizardId: null,
                walletBalance: 0,
                amount: 0,
                bankJournalId: "",
                journals: [],
                notes: "",
                dmId: null,
                saving: false,
            },
        });

        onWillStart(async () => {
            await this.loadDeliveryMen();
            await this.refreshActive();
        });

        onWillUpdateProps(async (nextProps) => {
            const nextTab = this._allowedPerfTab(nextProps.requestedPerfSubTab);
            if (nextTab !== this.state.perfSubTab) {
                this.state.perfSubTab = nextTab;
                await this.refreshActive();
            }
            if (nextProps.requestedOpenSettle && !this.props.requestedOpenSettle) {
                this.state.perfSubTab = "collections";
                await this.refreshActive();
            }
        });
    }

    _allowedPerfTab(tab) {
        if (tab === "sessions" || tab === "collections" || tab === "settlements" || tab === "jobs") {
            if ((tab === "collections" || tab === "settlements") && !this.hasFinancialAccess) {
                return "jobs";
            }
            return tab;
        }
        return "jobs";
    }

    get hasFinancialAccess() {
        return hasFinancialAccess();
    }

    async loadDeliveryMen() {
        this.state.lookupDeliveryMen = await this.orm.searchRead(
            "res.users",
            [["shahtaj_is_delivery_man", "=", true], ["active", "=", true]],
            ["id", "name"],
            { order: "name asc", limit: 300 },
        );
    }

    dateDomain(field = "scheduled_date") {
        const domain = [];
        if (this.state.dateFrom) domain.push([field, ">=", this.state.dateFrom]);
        if (this.state.dateTo) domain.push([field, "<=", this.state.dateTo]);
        return domain;
    }

    _countMap(groups) {
        const map = {};
        for (const g of groups || []) {
            const id = Array.isArray(g.delivery_man_id) ? g.delivery_man_id[0] : g.delivery_man_id;
            if (!id) continue;
            map[id] = g.delivery_man_id_count || g.__count || 0;
        }
        return map;
    }

    async fetchJobAggregates() {
        this.state.isLoading = true;
        notifyPortalBusy(true);
        try {
            const base = this.dateDomain("scheduled_date");
            const groupArgs = (extra) => [base.concat(extra), ["delivery_man_id"], ["delivery_man_id"]];
            const [all, delivered, picked, partial, inTransit, failed, closed] = await Promise.all([
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["state", "=", "delivered"]])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["state", "=", "picked"]])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["state", "=", "partial"]])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["field_state", "=", "in_transit"]])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["field_state", "=", "failed"]])),
                this.orm.call("shahtaj.dm.delivery", "read_group", groupArgs([["field_state", "=", "not_attended"]])),
            ]);
            const allMap = this._countMap(all);
            const deliveredMap = this._countMap(delivered);
            const pickedMap = this._countMap(picked);
            const partialMap = this._countMap(partial);
            const transitMap = this._countMap(inTransit);
            const failedMap = this._countMap(failed);
            const closedMap = this._countMap(closed);
            const ids = Object.keys(allMap).map((id) => parseInt(id, 10));
            const names = Object.fromEntries(this.state.lookupDeliveryMen.map((u) => [u.id, u.name]));
            if (ids.length) {
                const missing = ids.filter((id) => !names[id]);
                if (missing.length) {
                    const extra = await this.orm.read("res.users", missing, ["name"]);
                    extra.forEach((u) => { names[u.id] = u.name; });
                }
            }
            this.state.jobRows = ids.map((id) => ({
                id,
                name: names[id] || `DM ${id}`,
                total: allMap[id] || 0,
                delivered: deliveredMap[id] || 0,
                picked: pickedMap[id] || 0,
                partial: partialMap[id] || 0,
                inTransit: transitMap[id] || 0,
                failed: failedMap[id] || 0,
                shopClosed: closedMap[id] || 0,
            })).sort((a, b) => b.total - a.total);
        } catch (error) {
            this.notification.add("Failed to load job stats: " + (error.data?.message || error.message), { type: "danger" });
            this.state.jobRows = [];
        } finally {
            this.state.isLoading = false;
            notifyPortalBusy(false);
        }
    }

    async openDmJobs(row) {
        this.state.selectedDm = row;
        this.state.pagination.drill.page = 1;
        await this.fetchDrillJobs();
    }

    closeDmJobs() {
        this.state.selectedDm = null;
        this.state.drillJobs = [];
    }

    async fetchDrillJobs() {
        if (!this.state.selectedDm) return;
        const pag = this.state.pagination.drill;
        const domain = [
            ["delivery_man_id", "=", this.state.selectedDm.id],
            ...this.dateDomain("scheduled_date"),
        ];
        const [total, jobs] = await Promise.all([
            this.orm.searchCount("shahtaj.dm.delivery", domain),
            this.orm.searchRead(
                "shahtaj.dm.delivery",
                domain,
                ["id", "display_name", "partner_id", "sale_order_id", "scheduled_date", "state", "field_state"],
                { limit: pag.limit, offset: (pag.page - 1) * pag.limit, order: "scheduled_date desc, id desc" },
            ),
        ]);
        this.state.pagination.drill.total = total;
        this.state.drillJobs = jobs.map((j) => ({
            id: j.id,
            name: j.display_name || (j.sale_order_id ? j.sale_order_id[1] : `Job ${j.id}`),
            shop: j.partner_id ? j.partner_id[1] : "—",
            order: j.sale_order_id ? j.sale_order_id[1] : "—",
            date: j.scheduled_date || "—",
            state: j.state,
            fieldState: j.field_state,
        }));
    }

    async fetchSessions() {
        this.state.isLoading = true;
        try {
            const pag = this.state.pagination.sessions;
            const domain = this.dateDomain("session_date");
            if (this.state.filters.sessions.dm !== "all") {
                domain.push(["delivery_man_id", "=", parseInt(this.state.filters.sessions.dm, 10)]);
            }
            const [total, rows] = await Promise.all([
                this.orm.searchCount("shahtaj.dm.day.session", domain),
                this.orm.searchRead(
                    "shahtaj.dm.day.session",
                    domain,
                    ["id", "delivery_man_id", "session_date", "state", "departed_at", "ended_at", "gps_min_distance_m", "gps_max_distance_m", "notes"],
                    { limit: pag.limit, offset: (pag.page - 1) * pag.limit, order: "session_date desc, id desc" },
                ),
            ]);
            this.state.pagination.sessions.total = total;
            this.state.sessions = rows.map((s) => ({
                id: s.id,
                dm: s.delivery_man_id ? s.delivery_man_id[1] : "—",
                date: s.session_date || "—",
                state: s.state,
                departed: s.departed_at || "—",
                ended: s.ended_at || "—",
                gpsMin: s.gps_min_distance_m || 0,
                gpsMax: s.gps_max_distance_m || 0,
                notes: s.notes || "",
            }));
        } catch (error) {
            this.notification.add("Failed to load sessions: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.isLoading = false;
        }
    }

    async resetSession(id) {
        try {
            await this.orm.call("shahtaj.dm.day.session", "action_reset_office", [[id]]);
            this.notification.add("Session reset to office.", { type: "success" });
            await this.fetchSessions();
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
        }
    }

    async fetchRecovery() {
        if (!this.hasFinancialAccess) {
            this.state.collections = [];
            this.state.settlements = [];
            return;
        }
        this.state.isLoading = true;
        try {
            const colPag = this.state.pagination.collections;
            const setPag = this.state.pagination.settlements;
            const payDomain = [["shahtaj_is_dm_wallet_collection", "=", true], ...this.dateDomain("date")];
            const setDomain = this.dateDomain("settlement_date");
            if (this.state.filters.collections.dm !== "all") {
                payDomain.push(["shahtaj_collected_by_dm_id", "=", parseInt(this.state.filters.collections.dm, 10)]);
            }
            if (this.state.filters.settlements.dm !== "all") {
                setDomain.push(["delivery_man_id", "=", parseInt(this.state.filters.settlements.dm, 10)]);
            }
            const [colTotal, collections, setTotal, settlements] = await Promise.all([
                this.orm.searchCount("account.payment", payDomain),
                this.orm.searchRead(
                    "account.payment",
                    payDomain,
                    ["id", "name", "date", "amount", "partner_id", "shahtaj_collected_by_dm_id", "shahtaj_payment_channel", "shahtaj_instrument_reference", "shahtaj_has_cheque_image", "shahtaj_dm_delivery_id", "shahtaj_payment_notes", "state"],
                    { limit: colPag.limit, offset: (colPag.page - 1) * colPag.limit, order: "date desc, id desc" },
                ),
                this.orm.searchCount("shahtaj.dm.wallet.settlement", setDomain),
                this.orm.searchRead(
                    "shahtaj.dm.wallet.settlement",
                    setDomain,
                    ["id", "name", "delivery_man_id", "amount", "settlement_date", "bank_journal_id", "settled_by_id", "move_id", "state"],
                    { limit: setPag.limit, offset: (setPag.page - 1) * setPag.limit, order: "settlement_date desc, id desc" },
                ),
            ]);
            this.state.pagination.collections.total = colTotal;
            this.state.pagination.settlements.total = setTotal;
            this.state.collections = collections.map((p) => ({
                id: p.id,
                name: p.name,
                date: p.date,
                amount: p.amount || 0,
                shop: p.partner_id ? p.partner_id[1] : "—",
                dm: p.shahtaj_collected_by_dm_id ? p.shahtaj_collected_by_dm_id[1] : "—",
                channel: p.shahtaj_payment_channel || "cash",
                cheque: p.shahtaj_instrument_reference || "",
                hasChequeImage: !!p.shahtaj_has_cheque_image,
                job: p.shahtaj_dm_delivery_id ? p.shahtaj_dm_delivery_id[1] : "—",
                notes: p.shahtaj_payment_notes || "",
                state: p.state || "",
            }));
            this.state.settlements = settlements.map((s) => ({
                id: s.id,
                dm: s.delivery_man_id ? s.delivery_man_id[1] : "—",
                amount: s.amount || 0,
                date: s.settlement_date || "—",
                journal: s.bank_journal_id ? s.bank_journal_id[1] : "—",
                settledBy: s.settled_by_id ? s.settled_by_id[1] : "—",
                move: s.move_id ? s.move_id[1] : "—",
                state: s.state || "",
            }));
        } catch (error) {
            this.notification.add("Failed to load recovery: " + (error.data?.message || error.message), { type: "danger" });
        } finally {
            this.state.isLoading = false;
        }
    }

    async openSettleFromPicker() {
        const dmId = parseInt(this.state.settleDmId, 10);
        await this.openSettle(dmId);
    }

    async openSettle(dmId) {
        if (!dmId) {
            this.notification.add("Select a delivery man to settle.", { type: "warning" });
            return;
        }
        this.state.settleModal.saving = true;
        try {
            const wizardIds = await this.orm.create(
                "shahtaj.dm.wallet.settle",
                [{}],
                { context: { default_delivery_man_id: dmId, active_model: "res.users", active_id: dmId } },
            );
            const wizardId = Array.isArray(wizardIds) ? wizardIds[0] : wizardIds;
            const [wiz] = await this.orm.read("shahtaj.dm.wallet.settle", [wizardId], ["wallet_balance", "amount", "bank_journal_id"]);
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
                notes: "",
                dmId,
                saving: false,
            };
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
            this.state.settleModal.saving = false;
        }
    }

    closeSettle() {
        this.state.settleModal.open = false;
        this.state.settleModal.wizardId = null;
    }

    async confirmSettle() {
        if (!this.state.settleModal.wizardId) return;
        this.state.settleModal.saving = true;
        try {
            await this.orm.write("shahtaj.dm.wallet.settle", [this.state.settleModal.wizardId], {
                amount: Number(this.state.settleModal.amount) || 0,
                bank_journal_id: parseInt(this.state.settleModal.bankJournalId, 10),
                notes: this.state.settleModal.notes || "",
            });
            await this.orm.call("shahtaj.dm.wallet.settle", "action_confirm", [[this.state.settleModal.wizardId]]);
            this.notification.add("Wallet settled.", { type: "success" });
            this.closeSettle();
            await this.fetchRecovery();
        } catch (error) {
            this.notification.add(error.data?.message || error.message, { type: "danger" });
        } finally {
            this.state.settleModal.saving = false;
        }
    }

    setPerfSubTab(tab) {
        this.state.perfSubTab = tab;
        this.state.selectedDm = null;
        this.refreshActive();
    }

    onFilterChange(key) {
        if (this.state.pagination[key]) {
            this.state.pagination[key].page = 1;
        }
        if (key === "sessions") return this.fetchSessions();
        return this.fetchRecovery();
    }

    async refreshActive() {
        this.state.pagination.sessions.page = 1;
        this.state.pagination.collections.page = 1;
        this.state.pagination.settlements.page = 1;
        this.state.pagination.drill.page = 1;
        if (this.state.perfSubTab === "jobs") {
            if (this.state.selectedDm) return this.fetchDrillJobs();
            return this.fetchJobAggregates();
        }
        if (this.state.perfSubTab === "sessions") return this.fetchSessions();
        return this.fetchRecovery();
    }

    changePage(key, direction) {
        const pag = this.state.pagination[key];
        const newPage = pag.page + direction;
        const maxPage = Math.max(1, Math.ceil(pag.total / pag.limit));
        if (newPage < 1 || newPage > maxPage) return;
        pag.page = newPage;
        if (key === "drill") this.fetchDrillJobs();
        else if (key === "sessions") this.fetchSessions();
        else this.fetchRecovery();
    }

    formatMoney(value) {
        return (Number(value) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    }

    stockLabel(state) {
        const map = { not_ready: "Not ready", ready: "Ready", picked: "Picked", partial: "Partial", delivered: "Delivered", returned: "Returned" };
        return map[state] || state || "—";
    }

    fieldLabel(state) {
        const map = { pending: "Pending", in_transit: "In transit", done: "Done", not_attended: "Shop closed", failed: "Failed" };
        return map[state] || state || "—";
    }

    sessionLabel(state) {
        const map = { office: "Office", on_the_way: "On the way", ended: "Ended" };
        return map[state] || state || "—";
    }

    channelLabel(channel) {
        const map = { cash: "Cash", cheque: "Cheque", bank: "Bank" };
        return map[channel] || channel || "—";
    }

    openGpsDeliveries() {
        window.dispatchEvent(new CustomEvent("shahtaj-dashboard-switch", {
            detail: {
                tab: "operations",
                subTab: "checkins",
                checkinPurpose: "deliver",
                checkinRole: "delivery_man",
            },
        }));
    }
}

DeliveryManPerformance.template = "shahtaj_oil.DeliveryManPerformance";
